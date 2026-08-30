"use client";

import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { formatScore, type Score } from "@/lib/games";

// The shared high-score board. One DataGrid — the app's mandated table, which already
// handles search, sorting, column filters, CSV export and paging, and which delegates
// to DataGridCompact below 1024px so each row becomes a card rather than eight
// columns squeezed onto a phone.

/** Renders an ISO timestamp in the reader's own locale, date and time. */
function formatPlayedAt(iso: string): string {
  const played = new Date(iso);
  if (Number.isNaN(played.getTime())) return iso;
  return played.toLocaleString();
}

export function GamesScoresView({ scores }: { scores: Score[] }) {
  const columns: DataGridColumn<Score>[] = [
    {
      key: "rank",
      header: "#",
      // Rank is the row's position in the sorted set, so it is presentational only —
      // no `value`, which keeps it out of sorting, filtering and the CSV export
      // (where a stale rank against a re-sorted grid would be actively misleading).
      render: (row) => {
        const position = scores.findIndex((entry) => entry.id === row.id) + 1;
        return <span className="tabular-nums text-muted">{position}</span>;
      },
      minWidth: 48,
    },
    {
      key: "game",
      header: "Game",
      value: (row) => row.gameKey,
      render: (row) => <span className="text-ink">{row.gameKey}</span>,
    },
    {
      key: "player",
      header: "Player",
      value: (row) => row.userName,
      render: (row) => <span className="text-ink">{row.userName}</span>,
    },
    {
      key: "score",
      header: "Score",
      // The raw number is the `value`, so sorting and the footer total are numeric
      // while the cell still shows the game's own unit.
      value: (row) => row.score,
      render: (row) => (
        <span className="tabular-nums text-ink">{formatScore(row.gameKey, row.score)}</span>
      ),
      aggregate: "max",
      formatAggregate: (result) => `best ${result.toLocaleString()}`,
      className: "text-right",
    },
    {
      key: "moves",
      header: "Moves",
      value: (row) => row.moves,
      render: (row) => <span className="tabular-nums text-muted">{row.moves}</span>,
      className: "text-right",
    },
    {
      key: "playedAt",
      header: "Played",
      value: (row) => row.playedAt,
      render: (row) => (
        <span className="whitespace-nowrap text-muted">{formatPlayedAt(row.playedAt)}</span>
      ),
    },
  ];

  return (
    <DataGrid
      columns={columns}
      rows={scores}
      getRowKey={(row) => row.id}
      emptyMessage="Nobody has finished a game yet."
      exportFileName="game-scores"
      storageKey="myhomebase:games-scores-grid"
    />
  );
}
