"""Audit the referenced wrapper and probe project-required AKTools endpoints.

Run with the isolated AKTools Python environment. No production data is written.
"""

import argparse
import ast
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import redirect_stdout
from datetime import datetime, timezone
import importlib.metadata
import importlib.util
import inspect
import io
import json
from pathlib import Path
import subprocess
import time
from types import SimpleNamespace

import akshare
import requests


def inventory(repository):
    files = {}
    all_names = set()
    for path in sorted(repository.glob("*.py")):
        if path.name == "upload_to_github.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
        wrappers = [
            node for node in functions
            if any(isinstance(child, ast.Constant) and isinstance(child.value, str)
                   and "/api/public/" in child.value for child in ast.walk(node))
        ]
        counts = Counter(node.name for node in wrappers)
        all_names.update(counts)
        issues = []
        for node in {node.name: node for node in wrappers}.values():
            target = getattr(akshare, node.name, None)
            if not callable(target):
                issues.append({"endpoint": node.name, "kind": "missing_in_installed_akshare"})
                continue
            sent = set()
            for child in ast.walk(node):
                if isinstance(child, ast.Assign) and any(
                    isinstance(target, ast.Name) and target.id == "params"
                    for target in child.targets
                ) and isinstance(child.value, ast.Dict):
                    sent.update(key.value for key in child.value.keys if isinstance(key, ast.Constant))
            signature = inspect.signature(target)
            required = {
                name for name, param in signature.parameters.items()
                if param.default is inspect.Parameter.empty
                and param.kind not in (param.VAR_POSITIONAL, param.VAR_KEYWORD)
            }
            unsupported = sent - set(signature.parameters)
            if required - sent or unsupported:
                issues.append({
                    "endpoint": node.name, "kind": "parameter_mismatch",
                    "missing_required": sorted(required - sent),
                    "unsupported": sorted(unsupported), "signature": str(signature),
                })
        files[path.name] = {
            "definitions": len(wrappers), "unique": len(counts),
            "duplicates": {key: value for key, value in counts.items() if value > 1},
            "issues": issues, "endpoints": sorted(counts),
        }
    revision = subprocess.check_output(
        ["git", "-C", str(repository), "rev-parse", "HEAD"], text=True
    ).strip()
    return {"revision": revision, "files": files, "unique_endpoints": sorted(all_names)}


def cases(date, report_date, start_date):
    history = {"symbol": "000001", "start_date": start_date, "end_date": date, "adjust": "qfq"}
    return [
        ("universe", "stock_info_a_code_name", {}, [["code"], ["name"]]),
        ("spot-em", "stock_zh_a_spot_em", {}, [["代码"], ["最新价"], ["总市值"], ["流通市值"]]),
        ("spot-sina", "stock_zh_a_spot", {}, [["代码"], ["最新价"]]),
        ("spot-bj", "stock_bj_a_spot_em", {}, [["代码"], ["最新价"]]),
        ("history-day", "stock_zh_a_hist", {**history, "period": "daily"}, [["日期"], ["收盘"], ["成交量"]]),
        ("history-week", "stock_zh_a_hist", {**history, "period": "weekly"}, [["日期"], ["收盘"]]),
        ("history-month", "stock_zh_a_hist", {**history, "period": "monthly"}, [["日期"], ["收盘"]]),
        ("history-sh", "stock_zh_a_hist", {**history, "symbol": "600519"}, [["日期"], ["收盘"]]),
        ("history-bj", "stock_zh_a_hist", {**history, "symbol": "920002"}, [["日期"], ["收盘"]]),
        ("history-tencent", "stock_zh_a_hist_tx", {**history, "symbol": "sz000001"}, [["date"], ["close"], ["amount", "volume"]]),
        ("history-sina", "stock_zh_a_daily", {**history, "symbol": "sz000001"}, [["date"], ["close"], ["volume"]]),
        ("profile", "stock_individual_info_em", {"symbol": "000001"}, [["item"], ["value"]]),
        ("profile-business", "stock_zyjs_ths", {"symbol": "000001"}, [["主营业务"]]),
        ("performance", "stock_yjbb_em", {"date": report_date}, [["股票代码"], ["每股收益"], ["净资产收益率"]]),
        ("income", "stock_lrb_em", {"date": report_date}, [["股票代码"], ["营业总收入"], ["净利润"]]),
        ("balance", "stock_zcfz_em", {"date": report_date}, [["股票代码"], ["资产-总资产"], ["负债-总负债"]]),
        ("cashflow", "stock_xjll_em", {"date": report_date}, [["股票代码"], ["净现金流-净现金流"]]),
        ("annual-income", "stock_financial_report_sina", {"stock": "sz000001", "symbol": "利润表"}, [["报告日"], ["营业收入", "营业总收入"]]),
        ("forecast", "stock_profit_forecast_em", {}, [["代码"]]),
        ("margin-sz", "stock_margin_detail_szse", {"date": date}, [["证券代码"], ["融资余额"]]),
        ("margin-sh", "stock_margin_detail_sse", {"date": date}, [["标的证券代码"], ["融资余额"]]),
        ("north-holding", "stock_hsgt_hold_stock_em", {"market": "北向", "indicator": "今日排行"}, [["代码"]]),
        ("announcements", "stock_notice_report", {"symbol": "全部", "date": date}, [["代码"], ["公告标题"]]),
        ("news-stock", "stock_news_em", {"symbol": "000001"}, [["新闻标题"], ["发布时间"]]),
        ("news-global", "stock_info_global_em", {}, [["标题"], ["发布时间"]]),
        ("fund-flow", "stock_individual_fund_flow_rank", {"indicator": "今日"}, [["代码"], ["今日主力净流入-净额"]]),
        ("industry", "stock_board_industry_name_em", {}, [["板块名称"]]),
    ]


def probe(case, base_url, timeout, wrapper_names, payload_dir=None):
    case_id, endpoint, params, required = case
    started = time.monotonic()
    result = {
        "id": case_id, "endpoint": endpoint, "params": params,
        "in_wrapper": endpoint in wrapper_names,
        "in_akshare": callable(getattr(akshare, endpoint, None)),
    }
    try:
        response = requests.get(f"{base_url.rstrip('/')}/{endpoint}", params=params, timeout=timeout)
        result["http_status"] = response.status_code
        if not response.ok:
            result.update(status="http_error", detail=response.text[:600])
        else:
            payload = response.json()
            if not isinstance(payload, list):
                result.update(status="invalid_payload", detail=str(payload)[:600])
            else:
                if payload_dir:
                    payload_dir.mkdir(parents=True, exist_ok=True)
                    (payload_dir / f"{case_id}.json").write_text(
                        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
                    )
                columns = sorted({key for row in payload if isinstance(row, dict) for key in row})
                missing = [group for group in required if not any(key in columns for key in group)]
                result.update(
                    status="ok" if payload and not missing else "empty" if not payload else "schema_mismatch",
                    rows=len(payload), columns=columns, missing_fields=missing, sample=payload[:1],
                )
                dates = sorted({
                    str(row[key]) for row in payload if isinstance(row, dict)
                    for key in ("日期", "date", "报告日", "报告期", "公告日期", "发布时间", "最新公告日期")
                    if row.get(key)
                })
                if dates:
                    result["data_date_range"] = [dates[0], dates[-1]]
                code_key = next((key for key in ("股票代码", "代码", "code", "证券代码", "标的证券代码") if key in columns), None)
                if code_key:
                    codes = [str(row.get(code_key, "")) for row in payload]
                    result["unique_codes"] = len(set(codes))
                    result["duplicate_codes"] = len(codes) - len(set(codes))
    except requests.Timeout:
        result.update(status="timeout", detail=f"HTTP client timeout after {timeout}s; upstream work may continue")
    except (requests.RequestException, ValueError) as error:
        result.update(status="error", detail=str(error)[:600])
    result["elapsed_seconds"] = round(time.monotonic() - started, 3)
    return result


def wrapper_smoke(repository, base_url, timeout):
    spec = importlib.util.spec_from_file_location("audited_wrapper", repository / "akshare-api.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    results = []
    tests = [
        ("stock_zh_a_hist_tx", {"symbol": "sz000001", "start_date": "20260601", "end_date": "20260909", "adjust": "qfq"}),
        ("stock_financial_report_sina", {"stock": "sz000001", "indicator": "利润表"}),
        ("stock_zh_a_tick_tx", {"symbol": "sz000001"}),
        ("stock_dt_pool_em", {}),
        ("stock_market_activity_em", {}),
        ("stock_news_em", {"symbol": "000001"}),
    ]
    for name, params in tests:
        result = {"function": name, "params": params}

        def get(url, **kwargs):
            endpoint = url.rsplit("/", 1)[-1]
            response = requests.get(f"{base_url.rstrip('/')}/{endpoint}", timeout=timeout, **kwargs)
            result["http_status"] = response.status_code
            return response

        # Redirect only this wrapper's requests object; the source file is not changed.
        module.requests = SimpleNamespace(get=get, exceptions=requests.exceptions)
        captured = io.StringIO()
        started = time.monotonic()
        try:
            with redirect_stdout(captured):
                frame = getattr(module, name)(**params)
            result.update(rows=len(frame), status="ok" if len(frame) and result.get("http_status") == 200 else "failed")
        except Exception as error:
            result.update(status="error", detail=str(error)[:500])
        result["wrapper_output"] = captured.getvalue()[:500]
        result["elapsed_seconds"] = round(time.monotonic() - started, 3)
        results.append(result)
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, default=Path("tmp/akshare-api-audit/upstream"))
    parser.add_argument("--base-url", default="http://127.0.0.1:18080/api/public")
    parser.add_argument("--date", default="20260909", help="Explicit last completed trading day")
    parser.add_argument("--start-date", default="20260601")
    parser.add_argument("--report-date", default="20260630")
    parser.add_argument("--timeout", type=float, default=35)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--only", default="", help="Comma-separated case IDs")
    parser.add_argument("--inventory-only", action="store_true")
    parser.add_argument("--capture-payloads", action="store_true")
    parser.add_argument("--wrapper-smoke", action="store_true")
    parser.add_argument("--output", type=Path, default=Path("tmp/akshare-api-audit/coverage.json"))
    args = parser.parse_args()
    static = inventory(args.repository)
    selected = cases(args.date, args.report_date, args.start_date)
    if args.only:
        selected = [case for case in selected if case[0] in args.only.split(",")]
        if not selected:
            parser.error("--only selected no cases")
    report = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "akshare": akshare.__version__, "aktools": importlib.metadata.version("aktools"),
        "base_url": args.base_url, "inventory": static,
        "scope": "Project-required endpoint sample, not all wrapper endpoints or a full-market SLA test",
        "cases": [],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)

    def save():
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    save()
    if args.wrapper_smoke:
        report["wrapper_smoke"] = wrapper_smoke(args.repository, args.base_url, args.timeout)
        save()
    if not args.inventory_only:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            pending = [
                pool.submit(probe, case, args.base_url, args.timeout, static["unique_endpoints"],
                            args.output.parent / "payloads" if args.capture_payloads else None)
                for case in selected
            ]
            for future in as_completed(pending):
                result = future.result()
                report["cases"].append(result)
                print(f"{result['id']}: {result['status']} rows={result.get('rows', 0)} {result['elapsed_seconds']}s", flush=True)
                save()
    report["summary"] = dict(Counter(result["status"] for result in report["cases"]))
    report["completed"] = True
    save()
    print(json.dumps(report["summary"]), flush=True)


if __name__ == "__main__":
    main()
