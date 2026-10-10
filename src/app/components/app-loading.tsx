export function AppLoading({label = "正在加载页面…"}: {label?: string}) {
    return <div role="status" aria-live="polite" style={{
        width: "100%", minHeight: "50vh", display: "grid", placeContent: "center",
        gap: 12, textAlign: "center", color: "#64748b", background: "#f8fafc",
        fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
    }}>
        <strong style={{color: "#2878ff", fontSize: 20}}>LLM Market</strong>
        <span>{label}</span>
    </div>;
}
