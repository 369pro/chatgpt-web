"use client";

export default function ErrorPage({error, reset}: {
    error: Error & {digest?: string};
    reset: () => void;
}) {
    const staleAssets = /ChunkLoadError|Loading (?:CSS )?chunk|Failed to fetch dynamically imported module/i.test(error.message);

    // Keep recovery independent of page styles: a missing CSS chunk can cause this screen.
    return <main role="alert" style={{
        minHeight: "100vh", padding: 24, boxSizing: "border-box", display: "grid",
        placeContent: "center", textAlign: "center", background: "#f8fafc", color: "#1e293b",
        fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
    }}>
        <h1 style={{fontSize: 24}}>{staleAssets ? "页面已更新" : "页面暂时未能加载"}</h1>
        <p style={{color: "#64748b", lineHeight: 1.8}}>
            {staleAssets ? "重新加载即可使用最新版本。" : "请重试，或重新加载页面后继续。"}
            <br/>已保存的对话会保留。
        </p>
        <div style={{display: "flex", justifyContent: "center", gap: 12, marginTop: 16}}>
            {!staleAssets && <button onClick={reset} style={{padding: "10px 20px", cursor: "pointer"}}>重试</button>}
            <button onClick={() => window.location.reload()} style={{
                padding: "10px 20px", border: 0, borderRadius: 6, background: "#2878ff", color: "white", cursor: "pointer",
            }}>重新加载页面</button>
        </div>
    </main>;
}
