import type { QuoteResponse } from "@/lib/api";
import { chainLabel, formatAmount } from "@/lib/format";

/**
 * Where the conversion can be funded from: every chain with its balance,
 * what it costs to bring the funds to Arc, and why a source can't be used.
 */
export function RouteTable({ quote }: { quote: QuoteResponse }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead className="bg-panel-raised text-left text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Funds on</th>
            <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">Balance</th>
            <th className="hidden px-4 py-3 font-medium sm:table-cell">How</th>
            <th className="px-4 py-3 text-right font-medium">Fee</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {quote.routes.map((route) => {
            const isWinner = quote.winner?.sourceChain === route.sourceChain;
            return (
              <tr
                key={route.sourceChain}
                className={`border-t border-line ${isWinner ? "bg-brass/10" : ""}`}
              >
                <td className="px-4 py-3 font-medium">
                  {isWinner && <span className="mr-2 text-brass">★</span>}
                  {chainLabel(route.sourceChain)}
                </td>
                <td className="hidden px-4 py-3 text-right font-mono sm:table-cell">
                  {route.balance === null
                    ? "—"
                    : `${formatAmount(route.balance)} ${route.swapQuote.tokenIn}`}
                </td>
                <td className="hidden px-4 py-3 text-muted sm:table-cell">
                  {route.strategy === "swap_only" ? "Already on Arc" : "CCTP V2 → Arc"}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {route.costUsdc === "0" ? "none" : `${formatAmount(route.costUsdc)} USDC`}
                </td>
                <td className="px-4 py-3">
                  {route.executable ? (
                    <span className="rounded-full bg-ok/15 px-2 py-0.5 text-xs text-ok">Ready</span>
                  ) : (
                    <span className="text-xs text-muted">{route.reason}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
