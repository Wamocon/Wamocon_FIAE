import KnowledgeNoteDetail from "@/components/learning/KnowledgeNoteDetail";

export default async function Page(props: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await props.params;
  return <KnowledgeNoteDetail noteId={noteId} />;
}
