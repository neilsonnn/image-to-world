// A copied editor URL identifies the same project for browser requests and the CLI.
export function projectApi(
  route: string,
  search = globalThis.location?.search ?? "",
) {
  const id = new URLSearchParams(search).get("project");
  if (id === null) return "/api/" + route;
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid project link");
  return "/api/p/" + id + "/" + route;
}
