import {RawRoamBlock, RawRoamPage, RoamNode} from './raw-types'
import {Navigation} from './common/navigation'

import {countBy} from 'lodash-es'

import getBlockUidsReferencingPage from 'roamjs-components/queries/getBlockUidsReferencingPage'
import getBlockUidsReferencingBlock from 'roamjs-components/queries/getBlockUidsReferencingBlock'
import {nonNull} from '../utils/core'
import {BlockData, ReferenceFilter} from './types'

const DEFAULT_INSERT_ORDER = 'last'

export const Roam = {
    query(query: string, ...params: any[]): any[] {
        return window.roamAlphaAPI.q(query, ...params)
    },
    pull(dbid: number | string, selector = '[*]'): RawRoamPage | RawRoamBlock | null {
        if (!dbid) {
            console.log('bad id')
            return null
        }
        //@ts-ignore TODO reconcile types
        return window.roamAlphaAPI.pull(selector, dbid)
    },

    pullByUid(uid: string, selector = '[*]'): RawRoamPage | RawRoamBlock | null {
        return this.pull(`[:block/uid "${uid}"]`, selector)
    },

    queryFirst(query: string, ...params: any[]) {
        const results = this.query(query, ...params)
        if (!results?.[0] || results?.[0].length < 1) return null

        return this.pull(results[0][0])
    },

    listPageIds() {
        return this.query('[:find ?page :where [?page :node/title ?title] [?page :block/uid ?uid]]').flat()
    },

    listPages(): RawRoamPage[] {
        return this.listPageIds().map((dbId: number) => this.pull(dbId)!)
    },

    getUid(node: RoamNode) {
        return this.pull(node[':db/id'])?.[':block/uid']
    },

    focusedBlockInfo() {
        return window.roamAlphaAPI.ui.getFocusedBlock()
    },
}

function createAttributeString(name: string, value: string) {
    return `${name}::${value}`
}

export abstract class RoamEntity {

    static fromUid(uid: string): Page | Block | null {
        const rawEntity = Roam.pullByUid(uid)
        if (!rawEntity) return null

        return RoamEntity.fromRaw(rawEntity)
    }

    static fromRaw(rawEntity: RawRoamBlock | RawRoamPage) {
        if (rawEntity[':node/title']) return new Page(rawEntity)
        return new Block(rawEntity as RawRoamBlock)
    }

    constructor(readonly rawEntity: RawRoamBlock | RawRoamPage) {
        return new Proxy(this, {
            get(origin, property: keyof RoamEntity | string) {
                if (property in origin) return origin[property as keyof RoamEntity]

                return origin.child(property)
            },
        })
    }

    abstract get text(): string
    abstract set text(value: string)

    get rawChildren(): RawRoamBlock[] {
        const children = this.rawEntity[':block/children']?.map(it => Roam.pull(it[':db/id'])) as RawRoamBlock[]
        /**
         * Sorted because the order of the children returned is ~arbitrary
         */
        return children?.sort((a, b) => a[':block/order']! - b[':block/order']!) || []
    }

    get children(): Block[] {
        return this.rawChildren.map(it => new Block(it))
    }

    abstract get parent(): RoamEntity | null

    abstract get parents(): RoamEntity[]

    get uid(): string {
        return this.rawEntity[':block/uid']
    }

    get url(): string {
        return Navigation.urlForUid(this.uid)
    }

    get createdTime(): number {
        return this.rawEntity[':create/time']
    }

    /**
     * The desired effect is to be able to get child blocks either by content or by order
     * block[number] would give you children by order (block[0] is a first child)
     * block.content or block["content"] would give you a child by content
     *
     * Todo potentially allow accessing the roam attributes without having to specify `::` at the end
     * Todo can i support regex selectors? - maybe. would require custom parsing though, everythign I get is a string =\
     */
    child(property: string): Block | Block[] | null {
        const idx = parseInt(property)
        if (Number.isInteger(idx)) return this.children?.[idx]

        //todo check for regex stuff explicitly
        return this.childWithValue(property) ||
            this.childrenMatching(new RegExp(`^${property}::`))?.[0] ||
            this.childrenMatching(new RegExp(property))
    }

    childWithIndexOrValue(indexOrValue: string): Block | null {
        const idx = parseInt(indexOrValue)
        if (Number.isInteger(idx)) return this.children?.[idx]

        return this.childWithValue(indexOrValue)
    }

    childWithValue(content: string): Block | null {
        return this.children?.find(it => it.text === content) ?? null
    }

    async childAtPath(path: string[], createIfMissing = false): Promise<Block | null> {
        let block: Block | RoamEntity = this
        for (const part of path) {
            const existing: Block | null = block.childWithIndexOrValue(part)
            if (existing) {
                block = existing
                continue
            }

            if (!createIfMissing) return null

            block = await block.appendChild(part)
        }

        return block as Block
    }

    childrenMatching(regex: RegExp) {
        const result = this.children?.filter(it => regex.test(it.text))
        return result?.length ? result : null
    }

    get rawLinkedEntities(): (RawRoamPage | RawRoamBlock)[] {
        return this.rawEntity[':block/refs']?.map(it => Roam.pull(it[':db/id'])).filter(nonNull) ?? []
    }

    get linkedEntities(): RoamEntity[] {
        return this.getLinkedEntities()
    }

    getLinkedEntities(includeRefsFromParents: boolean = false): RoamEntity[] {
        const local = this.rawLinkedEntities.map(it => RoamEntity.fromRaw(it))
        const fromParents = includeRefsFromParents ?
            (this.parents.flatMap(it => it?.getLinkedEntities() ?? [])) :
            []
        return [...local, ...fromParents]
    }

    setAttribute(name: string, value: string) {
        const existing = this.child(name) as Block
        if (existing) {
            existing.setAsAttribute(name, value)
            return
        }

        return this.appendChild(createAttributeString(name, value))
    }

    setAsAttribute(name: string, value: string) {
        this.text = createAttributeString(name, value)
    }

    firstAttributeBlock(name: string): Block | undefined {
        return this.getAttributeBlocks(name)[0]
    }

    getAttributeBlocks(name: string): Block[] {
        // todo roam actually parses the attributes separately, so I probably should use that
        return this.childrenMatching(new RegExp(`^${name}::`)) ?? []
    }


    /**
     * Preferred version to use
     */
    async appendChild(childData: BlockData): Promise<Block>;
    /**
     * @deprecated use appendTextChild instead
     */
    async appendChild(childData: string): Promise<Block>;
    async appendChild(childData: string | BlockData): Promise<Block> {
        if (typeof childData === 'string') return this.appendTextChild(childData)

        return this.insertChild(childData)
    }

    async insertChild(childData: BlockData): Promise<Block> {
        const newUid = childData.uid || window.roamAlphaAPI.util.generateUID()
        await window.roamAlphaAPI.createBlock({
            location: {
                'parent-uid': this.uid,
                // @ts-ignore new thing
                order: childData.order || DEFAULT_INSERT_ORDER,
            },
            block: {
                string: childData.text,
                uid: newUid,
                open: childData.open,
            },
        })

        const childBlock = Block.fromUid(newUid)
        childData.children?.forEach(it => childBlock.insertChild(it))

        return childBlock
    }

    async appendTextChild(text: string, uid?: string): Promise<Block> {
        return this.insertChild({text, uid})
    }

    get backlinks(): RoamEntity[] {
        const backlinks = getBlockUidsReferencingBlock(this.uid)
        return backlinks.map(it => RoamEntity.fromUid(it)).filter(nonNull)
    }

    abstract get referenceFilter(): ReferenceFilter

    abstract get page(): Page
}

export class Page extends RoamEntity {
    constructor(rawPage: RawRoamPage) {
        super(rawPage)
    }

    get rawPage(): RawRoamPage {
        return this.rawEntity as RawRoamPage
    }

    static fromName(name: string) {
        const rawPage = Roam.queryFirst('[:find ?e :in $ ?a :where [?e :node/title ?a]]', name)
        return rawPage ? new this(rawPage) : null
    }

    static getOrCreate(name: string) {
        return this.fromName(name) || this.new(name)
    }

    static async new(name: string) {
        await window.roamAlphaAPI.createPage({
            page: {
                title: name,
            },
        })
        return Page.fromName(name)!
    }

    get text(): string {
        return this.rawPage[':node/title']
    }

    set text(value: string) {
        window.roamAlphaAPI.updatePage({
            page: {
                uid: this.uid,
                title: value,
            },
        })
    }

    get parent(): RoamEntity | null {
        return null
    }

    get parents(): RoamEntity[] {
        return []
    }

    get referenceFilter(): ReferenceFilter {
        //@ts-ignore todo types
        return window.roamAlphaAPI.ui.filters.getPageLinkedRefsFilters({page: {title: this.text}})
    }

    get page(): Page {
        return this
    }
}

export class Attribute extends Page {
    getUniqueValues(): Set<string> {
        return new Set(this.getAllValues())
    }

    getAllValues(): string[] {
        return getBlockUidsReferencingPage(this.text)
            .map(Block.fromUid)
            .flatMap(it => it?.listAttributeValues() || [])
    }

    getValuesByCount() {
        const allValues = this.getAllValues()
        return Object.entries(countBy(allValues))
            .sort(([, a], [, b]) => (a as number) - (b as number)).reverse()
    }

    findBlocksWithValue(value: string): Block[] {
        //todo compare perf of querying for "contains 2 pages"
        const attributeBlocks = getBlockUidsReferencingPage(this.text)
        const valuePageBlocks = new Set(getBlockUidsReferencingPage(value))
        let intersect = new Set(attributeBlocks.filter(i => valuePageBlocks.has(i)))

        //todo not exactly correct
        return [...intersect].map(Block.fromUid).filter(Boolean) as Block[]
        // return getBlockUidsReferencingPage("isa")
        //     .map(Block.fromUid)
        //     .filter(it => it?.listAttributeValues().includes(value))

    }


}


export class Block extends RoamEntity {
    constructor(rawBlock: RawRoamBlock) {
        super(rawBlock)
    }

    static get current() {
        const focusedBlockUid = Roam.focusedBlockInfo()?.['block-uid']
        return focusedBlockUid ? Block.fromUid(focusedBlockUid) : null
    }

    get rawBlock(): RawRoamBlock {
        return this.rawEntity as RawRoamBlock
    }

    static fromUid(uid: string) {
        return RoamEntity.fromUid(uid) as Block
    }

    get text(): string {
        return this.rawBlock[':block/string']
    }

    set text(value: string) {
        window.roamAlphaAPI.updateBlock({
            block: {
                uid: this.uid,
                string: value,
            },
        })
    }

    get parent(): RoamEntity | null {
        const parentIds = this.rawBlock[':block/parents']
        if (!parentIds) return null

        // TODO: unreliable this ends up not being correct for Readwise created nodes 🤔
        const directParentId = parentIds[parentIds.length - 1]

        const rawParent = directParentId && Roam.pull(directParentId[':db/id'])
        return rawParent ? RoamEntity.fromRaw(rawParent) : null
    }

    get parents(): RoamEntity[] {
        const parentIds = this.rawBlock[':block/parents']
        if (!parentIds) return []

        return parentIds.map(it => RoamEntity.fromRaw(Roam.pull(it[':db/id'])!))
    }

    get containerPage(): Page {
        return new Page(Roam.pull(this.rawBlock[':block/page'][':db/id'])!)
    }

    /**
     * Attribute value is weird - can be any of the children or the same-line value
     */
    get attributeValue(): string | undefined {
        return this.text.split('::')[1]?.trim()
    }

    get definesAttribute(): boolean {
        return this.text.includes('::')
    }

    listAttributeValues(splitRegex?: RegExp): string[] {
        if (!this.definesAttribute) return []

        // todo do we just want text values?
        const childrenValues = this.children.map(it => it.text)


        // todo doing this vs default value, because this breaks safari
        // which does not support lookbehind =\ (roam-date bug)
        const defaultRegex = new RegExp('(?<=])\\s?(?=\\[)', 'g')
        const inPlaceValues = this.listInPlaceAttributeValues(splitRegex ? splitRegex : defaultRegex)

        return [...inPlaceValues, ...childrenValues]
    }

    listInPlaceAttributeValues(splitRegex: RegExp) {
        const valueStr = this.text.split('::')[1]?.trim()
        return valueStr?.split(splitRegex)?.filter(it => it) || []
    }

    get referenceFilter(): ReferenceFilter {
        throw new Error('Not supported by Roam')
    }

    get page(): Page {
        return new Page(Roam.pull(this.rawBlock[':block/page'][':db/id'])!)!
    }
}

export {matchesFilter} from './collection'
