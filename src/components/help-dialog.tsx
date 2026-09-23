import { Dialog } from "@/components/ui/dialog";

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Dashboard",
    keys: [
      ["← → ↑ ↓", "Move day selection"],
      ["Enter", "Open selected day"],
      ["[ / ]", "Previous / next month"],
      ["a", "Analyze selected day"],
      ["A", "Analyze all missing this month"],
      ["x", "Ignore / un-ignore selected day"],
    ],
  },
  {
    title: "Day view",
    keys: [
      ["[ / ]  or  Ctrl+← / →", "Previous / next day"],
      ["a", "Analyze / re-analyze this day"],
      ["c", "Focus context notes"],
      ["/", "Focus the ask-to-change box"],
      ["@", "(button) reference a row/gap for the AI"],
      ["+", "(gap button) create an entry filling the gap"],
      ["✓", "(left checkbox) approve — protects the row from AI edits"],
      ["split / merge", "(right buttons) split a row in two / merge down (fills a following gap first, next entry on 2nd click)"],
      ["↑ ↓", "In a time box: move by 15 min"],
      ["n", "Approve the next unapproved row (or the selected one after editing it) and jump to it"],
      ["e", "Add a new entry"],
      ["s", "Open submit dialog"],
      ["Ctrl+Enter", "In the submit dialog: submit (or close once done)"],
      ["x", "Ignore / un-ignore day"],
      ["g", "Back to dashboard"],
      ["Esc", "Close dialogs"],
    ],
  },
  {
    title: "Everywhere",
    keys: [["?", "This help"]],
  },
];

export function HelpDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" className="max-w-xl">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {g.title}
            </h3>
            <table className="w-full text-sm">
              <tbody>
                {g.keys.map(([k, desc]) => (
                  <tr key={k}>
                    <td className="py-1 pr-3 whitespace-nowrap align-top">
                      <kbd>{k}</kbd>
                    </td>
                    <td className="py-1 text-muted-foreground">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
