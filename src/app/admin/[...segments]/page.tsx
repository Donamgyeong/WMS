import { WorkspacePage } from "@/modules/workspace/server";
export default async function AdminPage({ params }: { params: Promise<{ segments: string[] }> }) {
  const { segments } = await params;
  return <WorkspacePage area="admin" segments={segments} />;
}
