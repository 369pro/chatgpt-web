import { PropsWithChildren } from "react";
import { Resizable } from "re-resizable";
interface Props {
    minWidth?: number;
}
export function DialogResizeableSidebar(props: PropsWithChildren<Props>) {
    const {minWidth = 200, children} = props;
    return (
        <Resizable
            minWidth={minWidth}
            maxWidth={320}
            defaultSize={{
                width: "100%",
                height: "100%",
            }}
            enable={{}}
            style={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                overflow: 'hidden',
                borderRight: '1px solid #f5f5f5'
            }}
        >
            {children}
        </Resizable>
    );
}
