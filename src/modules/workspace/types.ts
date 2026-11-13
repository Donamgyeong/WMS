export type ViewNode = {
  tag: string;
  id: string;
  name?: string;
  className: string;
  children: (ViewNode | string)[];
};
export type WorkspaceView = { desktop: ViewNode; mobile: ViewNode };
export function nodeText(node: ViewNode | string): string {
  return typeof node === "string" ? node : node.children.map(nodeText).join(" ");
}
