import type { WrappedData } from "@/lib/wrapped";

/**
 * 5×5 agreement heatmap: how many of the 72 group scorelines each pair predicted
 * IDENTICALLY. Darker = more alike. The diagonal is greyed out (self).
 */
export default function AgreementHeatmap({
  matrix,
}: {
  matrix: WrappedData["global"]["agreementMatrix"];
}) {
  const { usernames, identical } = matrix;
  const max = Math.max(1, ...identical.flat());
  const short = (n: string) => (n.length > 10 ? n.slice(0, 9) + "…" : n);

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-center text-xs">
        <thead>
          <tr>
            <th className="p-1" />
            {usernames.map((n) => (
              <th key={n} className="p-1 align-bottom">
                <div className="mx-auto h-16 w-6 origin-bottom -rotate-45 whitespace-nowrap text-left opacity-70">
                  {short(n)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {usernames.map((rowName, i) => (
            <tr key={rowName}>
              <th className="p-1 pr-2 text-right font-medium opacity-70 whitespace-nowrap">{short(rowName)}</th>
              {usernames.map((colName, j) => {
                const v = identical[i][j];
                if (i === j) {
                  return (
                    <td key={colName} className="h-10 w-10 rounded bg-black/5 text-black/30 dark:bg-white/5 dark:text-white/30">
                      —
                    </td>
                  );
                }
                const alpha = 0.12 + 0.78 * (v / max);
                return (
                  <td
                    key={colName}
                    className="h-10 w-10 rounded font-semibold text-white"
                    style={{ backgroundColor: `rgba(99,102,241,${alpha.toFixed(3)})` }}
                    title={`${rowName} & ${colName}: ${v}/72 identical scorelines`}
                  >
                    {v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
