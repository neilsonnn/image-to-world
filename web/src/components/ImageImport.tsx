import { useCallback, useState } from "react";
import { Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { assetUrl, type Asset, type Camera } from "../../../core/schema";
import { useImageToWorldClient } from "../lib/client";

export const ASSET_CLIPBOARD_TYPE = "application/x-image-to-world-assets+json";
export type PlacementDestination = {
  parentId?: string | null;
  beforeId?: string | null;
};
export type RequestPlacement = (
  assets: Asset[],
  camera?: Camera,
  destination?: PlacementDestination,
) => void;
export function clipboardAssetIds(data: DataTransfer): string[] {
  try {
    const ids = JSON.parse(data.getData(ASSET_CLIPBOARD_TYPE));
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}
export function useImageImport() {
  const client = useImageToWorldClient();
  const [pending, setPending] = useState<{
    assets: Asset[];
    camera?: Camera;
    destination?: PlacementDestination;
  } | null>(null);
  const place = useCallback(
    async (
      assets: Asset[],
      mode: "reference" | "individual" | "reconstruct",
      camera?: Camera,
      destination?: PlacementDestination,
    ) => {
      await client.command({
        type: "assets.place",
        assetIds: assets.map((asset) => asset.id),
        mode,
        camera,
        ...destination,
      });
    },
    [client],
  );
  const requestPlacement: RequestPlacement = useCallback(
    (assets, camera, destination) => {
      const unique = [
        ...new Map(assets.map((asset) => [asset.id, asset])).values(),
      ];
      if (unique.filter((asset) => asset.kind === "image").length > 1) {
        setPending({ assets: unique, camera, destination });
        return;
      }
      void place(unique, "reference", camera, destination).catch((cause) =>
        client.setError(String(cause)),
      );
    },
    [client, place],
  );
  const choose = (mode: "reference" | "individual" | "reconstruct") => {
    if (!pending) return;
    const { assets, camera, destination } = pending;
    setPending(null);
    void place(assets, mode, camera, destination).catch((cause) =>
      client.setError(String(cause)),
    );
  };
  return {
    requestPlacement,
    dialog: (
      <Dialog.Root
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <Dialog.Content maxWidth="580px">
          <Dialog.Title size="3">Bring images into your scene</Dialog.Title>
          <Dialog.Description size="1">
            Place references immediately, or use World Labs to estimate depth
            and camera alignment. Original images keep their resolution.
          </Dialog.Description>
          <Flex gap="2" my="3" wrap="wrap">
            {pending?.assets
              .filter((a) => a.kind === "image")
              .map((asset) => (
                <img
                  key={asset.id}
                  src={assetUrl(asset)}
                  alt={asset.name}
                  style={{ width: 100, height: 72, objectFit: "contain" }}
                />
              ))}
          </Flex>
          <Flex gap="2" wrap="wrap">
            <Button
              size="1"
              variant="surface"
              color="gray"
              onClick={() => choose("reference")}
            >
              Place references
            </Button>
            <Button
              size="1"
              variant="surface"
              color="gray"
              onClick={() => choose("individual")}
            >
              Pose individually
            </Button>
            <Button
              size="1"
              variant="surface"
              color="gray"
              onClick={() => choose("reconstruct")}
            >
              Reconstruct together
            </Button>
          </Flex>
          <Text as="p" size="1" color="gray" mt="3">
            Reference placement is local. Reconstruction uses your configured
            provider.
          </Text>
        </Dialog.Content>
      </Dialog.Root>
    ),
  };
}
