import SharedChart from "@/components/SharedChart";

/**
 * Someone else's chart, opened from a link.
 *
 * There is no audio here and there never will be — the sender's recording
 * stayed on their machine. What travels is the writing: the parts, the tempo,
 * the key, the sections. A player can read their part straight off this page,
 * and open it in the studio against their own copy of the song.
 */
export default async function SharedChartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SharedChart id={id} />;
}
