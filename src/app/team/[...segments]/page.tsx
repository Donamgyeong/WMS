import { WorkspacePage } from "@/modules/workspace/server";
export default async function TeamPage({ params }: { params: Promise<{ segments: string[] }> }) {
  const { segments } = await params;
  return <WorkspacePage area="team" segments={segments} />;
}
