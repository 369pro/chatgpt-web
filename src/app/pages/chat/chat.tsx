import styles from './chat.module.scss';
import {DialogList} from "@/app/components/dialog/dialog-list";
import {Outlet, useLocation} from 'react-router-dom';
import {useEffect, useState} from 'react';

export function Chat() {
    const location = useLocation();
    const [showList, setShowList] = useState(false);
    useEffect(() => { setShowList(false); }, [location.key]);
    return (
        <div className={`${styles.chat} ${showList || location.pathname === "/chat" ? styles.showList : ''}`}>
            <div className={styles.sessions}>
                <DialogList onSelect={() => setShowList(false)}/>
            </div>
            <div className={styles.conversation}>
                <Outlet context={{showSessions: () => setShowList(true)}}/>
            </div>
        </div>
    );
}
