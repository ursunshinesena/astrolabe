import type { QuoteResponse } from "@/lib/api";
import { chainLabel, formatAmount } from "@/lib/format";

/** Every quoted route side by side, best first, with failures kept visible. */
export function RouteTable({ quote }: { quote: QuoteResponse }) {
  const token = quote.tokenOut.toUpperCase() === "ETH" ? "WETH" : quote.tokenOut.toUpperCase();
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead className="bg-panel-raised text-left text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Destination</th>
            <th className="hidden px-4 py-3 font-medium sm:table-cell">Strategy</th>
            <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">Quote</th>
            <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">Bridge fee</th>
            <th className="px-4 py-3 text-right font-medium">Net {token}</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {quote.routes.map((route) => {
            const isWinner =
              quote.winner === null
                ? false
                : route.destinationChain === quote.winner.destinationChain;
            return (
              <tr
                key={`${route.strategy}-${route.destinationChain}`}
                className={`border-t border-line ${isWinner ? "bg-brass/10" : ""}`}
              >
                <td className="px-4 py-3 font-medium">
                  {isWinner && <span className="mr-2 text-brass">★</span>}
                  {chainLabel(route.destinationChain)}
                </td>
                <td className="hidden px-4 py-3 text-muted sm:table-cell">
                  {route.strategy === "bridge_then_swap"
                    ? "CCTP V2 bridge → swap"
                    : "Swap in place"}
                </td>
                <td className="hidden px-4 py-3 text-right font-mono sm:table-cell">
                  {formatAmount(route.swapQuote.amountOut)} {token}
                </td>
                <td className="hidden px-4 py-3 text-right font-mono text-muted sm:table-cell">
                  {route.bridgeFee.amount === "0" ? "—" : `${route.bridgeFee.amount} USDC`}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {formatAmount(route.netAmountOut)}
                </td>
                <td className="px-4 py-3">
                  {route.executable ? (
                    <span className="rounded-full bg-ok/15 px-2 py-0.5 text-xs text-ok">
                      Executable
                    </span>
                  ) : (
                    <span className="text-xs text-muted" title={route.reason}>
                      Quote only
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
          {quote.failures.map((f) => (
            <tr key={`fail-${f.chain}`} className="border-t border-line text-muted">
              <td className="px-4 py-3">{chainLabel(f.chain)}</td>
              <td className="px-4 py-3" colSpan={5}>
                <span className="text-bad">No quote</span> — {f.error}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
