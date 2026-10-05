import "./styles/globals.scss";

export const metadata = {
    title: "LLM Market | 个人中心",
    description: "LLM Market 智能对话与福利中心",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
    return <html lang="zh-CN"><body>{children}</body></html>;
}
