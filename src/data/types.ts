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
    text: string
    uid?: string
    order?: number | 'first' | 'last' // Defaults to 'last'
    children?: BlockData[]
    open?: boolean
}
