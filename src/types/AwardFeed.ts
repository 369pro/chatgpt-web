export interface AwardFeedItem {
    recordId: string;
    winnerName: string;
    awardId: number;
    awardTitle: string;
    awardTime: string;
}

export interface AwardFeed {
    records: AwardFeedItem[];
    broadcasts: AwardFeedItem[];
    total: number;
    pageNo: number;
    pageSize: number;
    recordLimit: number;
}
