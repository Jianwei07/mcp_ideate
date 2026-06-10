import { realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

export const CACHE_ROOT_NAME = "secure-research-cache";

export type McpRoot = {
  uri: string;
  name?: string;
};

export async function selectCacheRoot(roots: McpRoot[]): Promise<string> {
  const matching = roots.filter((root) => root.name === CACHE_ROOT_NAME);
  if (matching.length !== 1) {
    throw new Error(
      `Client must provide exactly one approved '${CACHE_ROOT_NAME}' root`,
    );
  }
  return rootUriToPath(matching[0]);
}

export async function rootUriToPath(root: McpRoot): Promise<string> {
  const url = new URL(root.uri);
  if (url.protocol !== "file:") {
    throw new Error("The research cache root must use a file URI");
  }
  if (url.hostname && url.hostname !== "localhost") {
    throw new Error("Remote file roots are not allowed");
  }
  const path = await realpath(decodeURIComponent(url.pathname));
  if (!(await stat(path)).isDirectory()) {
    throw new Error("The research cache root must be an existing directory");
  }
  return path;
}

export function resolveWithinRoot(root: string, relativeName: string): string {
  const rootPath = resolve(root);
  const target = resolve(rootPath, relativeName);
  if (target !== rootPath && !target.startsWith(`${rootPath}${sep}`)) {
    throw new Error("Cache path escapes the approved root");
  }
  return target;
}
