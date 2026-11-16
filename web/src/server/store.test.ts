import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { identity } from "../../../core/schema";
import { WorkspaceStore } from "./store";
const stores: WorkspaceStore[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "worldbash-store-"));
  roots.push(root);
  const store = await new WorkspaceStore(root).init();
  stores.push(store);
  return store;
}
test("serializes concurrent browser and CLI writes without dropping updates", async () => {
  const store = await setup();
  await Promise.all(
    Array.from({ length: 15 }, (_, i) =>
      store.update((state) => {
        state.name += ` ${i}`;
      }),
    ),
  );
  expect(store.snapshot().name).toBe(
    "Untitled workspace " + Array.from({ length: 15 }, (_, i) => i).join(" "),
  );
  expect(
    JSON.parse(await readFile(path.join(store.root, "workspace.json"), "utf8"))
      .revision,
  ).toBe(15);
});
test("syncs nested additions and replacements, and drops removed files only when unused", async () => {
  const store = await setup();
  await mkdir(path.join(store.assetsPath, "nested"));
  const file = path.join(store.assetsPath, "nested", "photo.png");
  await writeFile(file, "original");
  await store.syncAssets();
  const asset = Object.values(store.snapshot().assets)[0];
  await store.update((state) => {
    state.assets[asset.id].name = "My photo";
  });
  await writeFile(file, "replacement image");
  await store.syncAssets();
  expect(store.snapshot().assets[asset.id].size).toBe(17);
  expect(store.snapshot().assets[asset.id].name).toBe("My photo");
  const used = path.join(store.assetsPath, "nested", "used.png");
  await writeFile(used, "in the scene");
  await store.syncAssets();
  const usedAsset = Object.values(store.snapshot().assets).find(
    (item) => item.name === "used.png",
  )!;
  await store.update((state) => {
    state.nodes.used = {
      id: "used",
      name: "Used",
      kind: "image",
      assetId: usedAsset.id,
      parentId: null,
      visible: true,
      transform: identity(),
    };
  });
  await rm(path.join(store.assetsPath, "nested"), { recursive: true });
  await store.syncAssets();
  expect(store.snapshot().assets[asset.id]).toBeUndefined();
  expect(store.snapshot().assets[usedAsset.id].missing).toBe(true);
});
test("binary imports and workspace metadata survive reopening", async () => {
  const store = await setup();
  const asset = await store.importFile(
    new Blob([new Uint8Array([0, 255, 128])]),
    "image.png",
  );
  await store.close();
  stores.splice(stores.indexOf(store), 1);
  const reopened = await new WorkspaceStore(store.root).init();
  stores.push(reopened);
  const { file } = await reopened.assetFile(asset.id);
  expect([...(await readFile(file))]).toEqual([0, 255, 128]);
  expect(reopened.snapshot().assets[asset.id].path).toBe(asset.path);
});
test("rejects a second writer and refuses symlink escapes", async () => {
  const store = await setup();
  await expect(new WorkspaceStore(store.root).init()).rejects.toThrow(
    "already open",
  );
  const asset = await store.importFile(new Blob(["safe"]), "safe.png");
  const outside = path.join(store.root, "private.txt");
  await writeFile(outside, "private");
  await rm(path.join(store.assetsPath, asset.path));
  await symlink(outside, path.join(store.assetsPath, asset.path));
  await expect(store.assetFile(asset.id)).rejects.toThrow("escapes");
});
test("invalid external JSON blocks edits without overwriting the broken file", async () => {
  const store = await setup();
  const file = path.join(store.root, "workspace.json");
  await writeFile(file, "broken");
  await expect(
    store.update((state) => {
      state.name = "changed";
    }),
  ).rejects.toThrow();
  expect(await readFile(file, "utf8")).toBe("broken");
});

test("project trash preserves binary files and provenance across sync, restart, and restore", async () => {
  const { moveAssetsToTrash } = await import("./asset-files");
  const store = await setup();
  const original = await store.importFile(
    new Blob(["original pixels"]),
    "photo.png",
  );
  const edit = await store.importFile(new Blob(["edited pixels"]), "edit.png", {
    parentAssetId: original.id,
  });
  await moveAssetsToTrash(store, [original.id, edit.id]);
  await store.syncAssets();
  expect(await Bun.file(path.join(store.assetsPath, edit.path)).exists()).toBe(
    false,
  );
  expect(
    await Bun.file(
      (await store.assetFile(edit.id, { includeTrashed: true })).file,
    ).text(),
  ).toBe("edited pixels");
  await store.close();
  stores.splice(stores.indexOf(store), 1);
  const reopened = await new WorkspaceStore(store.root).init();
  stores.push(reopened);
  expect(reopened.snapshot().assets[edit.id].trashedAt).toBeNumber();
  await moveAssetsToTrash(reopened, [original.id, edit.id], true);
  expect(reopened.snapshot().assets[edit.id].parentAssetId).toBe(original.id);
  expect(reopened.snapshot().assets[edit.id].trashedAt).toBeUndefined();
  expect(await Bun.file((await reopened.assetFile(edit.id)).file).text()).toBe(
    "edited pixels",
  );
});

test("trashing a mixed selection with a scene dependency leaves every file in place", async () => {
  const { moveAssetsToTrash } = await import("./asset-files");
  const { createCapture } = await import("../../../core/captures");
  const store = await setup();
  const free = await store.importFile(new Blob(["free"]), "free.png");
  const used = await store.importFile(new Blob(["used"]), "used.png");
  await store.update((state) => {
    for (const node of createCapture(used, "capture"))
      state.nodes[node.id] = node;
  });
  await expect(moveAssetsToTrash(store, [free.id, used.id])).rejects.toThrow(
    "from the scene",
  );
  expect(await Bun.file((await store.assetFile(free.id)).file).text()).toBe(
    "free",
  );
  expect(await Bun.file((await store.assetFile(used.id)).file).text()).toBe(
    "used",
  );
});

test("restore refuses to overwrite a replacement file", async () => {
  const { moveAssetsToTrash } = await import("./asset-files");
  const store = await setup();
  const asset = await store.importFile(new Blob(["original"]), "photo.png");
  await moveAssetsToTrash(store, [asset.id]);
  await expect(store.assetFile(asset.id)).rejects.toThrow("Restore");
  await Bun.write(path.join(store.assetsPath, asset.path), "replacement");
  await expect(moveAssetsToTrash(store, [asset.id], true)).rejects.toThrow(
    "already exists",
  );
  expect(await Bun.file(path.join(store.assetsPath, asset.path)).text()).toBe(
    "replacement",
  );
  expect(
    await Bun.file(
      (await store.assetFile(asset.id, { includeTrashed: true })).file,
    ).text(),
  ).toBe("original");
});

test("trash refuses directory symlinks escaping the asset library", async () => {
  const { moveAssetsToTrash } = await import("./asset-files");
  const store = await setup();
  const asset = await store.importFile(new Blob(["original"]), "photo.png");
  const outside = path.join(store.root, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(store.assetsPath, ".trash"));
  await expect(moveAssetsToTrash(store, [asset.id])).rejects.toThrow("escapes");
  expect(await Bun.file(path.join(outside, asset.path)).exists()).toBe(false);
  expect(
    await Bun.file(
      (await store.assetFile(asset.id, { includeTrashed: true })).file,
    ).text(),
  ).toBe("original");
});
