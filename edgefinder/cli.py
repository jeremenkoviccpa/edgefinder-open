"""ef run | ef show [ASSET] | ef serve"""
import argparse
import json
import logging

from rich.console import Console
from rich.table import Table

from .db import get_kv
from .scoring import COLUMNS

console = Console()


def _cell(v: int) -> str:
    return f"[bold blue]{v}[/]" if v > 0 else f"[bold red]{v}[/]" if v < 0 else "[dim]0[/]"


def print_setups(result: dict):
    t = Table(title=f"Top Setups — {result['generated_at']}", header_style="bold")
    for h in ["Asset", "Bias", "Score", *COLUMNS]:
        t.add_column(h, justify="center")
    for r in result["setups"]:
        color = "blue" if r["score"] >= 5 else "red" if r["score"] <= -5 else "white"
        t.add_row(r["asset"], f"[{color}]{r['bias']}[/]", f"[bold {color}]{r['score']}[/]",
                  *[_cell(r["columns"][c]) for c in COLUMNS])
    console.print(t)
    bad = {k: v.get("error") for k, v in result["sources"].items() if not v.get("ok")}
    if bad:
        console.print("[yellow]Sources unavailable:[/]", bad)
    geo = result.get("geo_risk")
    if geo:
        console.print(f"\n[bold]Geopolitical risk:[/] {geo['score']}/100 ({geo['level']})")
        for e in (geo.get("llm") or {}).get("events", [])[:4]:
            console.print(f"  • [{e.get('region')}] {e.get('summary')}  → {', '.join(e.get('assets', []))}")
    for it in (result.get("news") or {}).get("items", [])[:5]:
        console.print(f"[bold]{it.get('title')}[/] ({it.get('tone')}) — {it.get('summary')}")


def print_scorecard(result: dict, asset: str):
    row = next((r for r in result["setups"] if r["asset"] == asset.upper()), None)
    if not row:
        console.print(f"[red]Unknown asset {asset}[/]")
        return
    console.print(f"[bold]{row['asset']}[/] — {row['bias']} ({row['score']})  groups={row['groups']}")
    if row.get("narrative"):
        console.print(f"[italic]{row['narrative']}[/]")
    console.print_json(json.dumps(row["detail"], default=str))


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="ef")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="fetch all data, score, run LLM digest")
    r.add_argument("--no-llm", action="store_true")
    s = sub.add_parser("show", help="print last results (optionally one asset's scorecard)")
    s.add_argument("asset", nargs="?")
    sv = sub.add_parser("serve", help="run the HTTP API + scheduler")
    sv.add_argument("--port", type=int, default=8000)
    a = p.parse_args()

    if a.cmd == "run":
        from .pipeline import run
        print_setups(run(with_llm=not a.no_llm))
    elif a.cmd == "show":
        res = get_kv("latest")
        if not res:
            console.print("No results yet — run `ef run` first.")
        elif a.asset:
            print_scorecard(res, a.asset)
        else:
            print_setups(res)
    elif a.cmd == "serve":
        import uvicorn
        uvicorn.run("edgefinder.api:app", host="0.0.0.0", port=a.port)


if __name__ == "__main__":
    main()
