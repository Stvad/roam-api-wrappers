export type ReferenceFilter = { includes: string[]; removes: string[] }

/**
 * todo: this should probably mimic
 *     block?: {
 *         string?: string;
 *         uid?: string;
 *         open?: boolean;
 *         heading?: number;
 *         "text-align"?: TextAlignment;
 *         "children-view-type"?: ViewType;
 *     }
 */
export interface BlockData {
    uid?: string
    text: string
    children?: BlockData[]
}
