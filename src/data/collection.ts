import {Page, RoamEntity} from './index'
import {ReferenceFilter} from './types'
import {RoamDate} from '../date'
import {groupBy} from 'lodash-es'

export const defaultExclusions = [
    /^ptr$/,
    /^otter\.ai\/transcript$/,
    /^otter\.ai$/,
    /^TODO$/,
    /^DONE$/,
    /^factor$/,
    /^interval$/,
    /^\[\[factor]]:.+/,
    /^\[\[interval]]:.+/,
    /^isa$/,
    /^repeat interval$/,
    RoamDate.onlyPageTitleRegex,
]

export const defaultLowPriority = [
    /^reflection$/,
    /^task$/,
    /^weekly review$/,
    /^person$/,
]

const defaultHighPriority = [
    /^i$/,
    /^sr$/,
    /^morning-task$/,
    /^TAP$/,
    /^dating$/,
]

type Priority = 'high' | 'default' | 'low'

const isPartOfHierarchy = (ref: RoamEntity) => ref instanceof Page && ref.text.includes('/')
/**
 * what I want is something like:
 * - create groups based on the most common page reference among all entities, excluding the things like factor, interval, TODO, DONE, etc
 * if one group is wholly contained within another - preserve the smaller group inside the larger group
 *
 * not sure about an efficient way to do this, but starting with creating all groups may be ok, given that we only run over like ~100 elements
 *
 * exclude the current page
 * ptr, otter transcript
 */
export const groupByMostCommonReferences = (
    entities: RoamEntity[],
    dontGroupReferencesTo: RegExp[] = defaultExclusions,
    groupPriorities: Record<Partial<'high' | 'low'>, RegExp[]> = {
        low: [...defaultExclusions, ...defaultLowPriority],
        high: defaultHighPriority,
    },
    addReferencesBasedOnAttributes: string[] = ['isa', 'group with'],
) => {
    // todo when we exclude all the things - just return one group

    // todo how important is dedup? (would it actually be better to show a few larger groups that have overlap?)
    // todo merge groups that overlap exactly
    const referenceGroups = buildReferenceGroups(entities, addReferencesBasedOnAttributes, dontGroupReferencesTo)

    return deduplicateAndSortGroups(referenceGroups, groupPriorities)
}

function buildReferenceGroups(entities: RoamEntity[], addReferencesBasedOnAttributes: string[], dontGroupReferencesTo: RegExp[]) {
    const referenceGroups = new Map<string, Map<string, RoamEntity>>()

    function addReferenceToGroup(referenceUid: string, entity: RoamEntity) {
        const group = referenceGroups.get(referenceUid)
        if (group) {
            group.set(entity.uid, entity)
        } else {
            referenceGroups.set(referenceUid, new Map([[entity.uid, entity]]))
        }
    }

    const notExcluded = (entity: RoamEntity) =>
        !dontGroupReferencesTo.some(it => it.test(entity.text))

    function addReferencesFromHierarchy(ref: RoamEntity, entity: RoamEntity) {
        if (!isPartOfHierarchy(ref)) return
        /**
         * Hierarchy stuff is underdefined, but general heuristic is name/whatever -> name is top
         * Nested hierarchies is a thing, not handling those for now
         */
        const topOfHierarchyName = ref.text.split('/')[0]
        const topOfHierarchy = Page.fromName(topOfHierarchyName)
        topOfHierarchy && notExcluded(topOfHierarchy) && addReferenceToGroup(topOfHierarchy.uid, entity)
    }

    function addReferencesFromAttribute(baseReference: RoamEntity, entity: RoamEntity, attributte: string) {
        const isNotAttributeReference = (it: RoamEntity) => it.text !== attributte

        baseReference.firstAttributeBlock(attributte)
            ?.linkedEntities.filter(isNotAttributeReference).filter(notExcluded)
            ?.forEach(ref => addReferenceToGroup(ref.uid, entity))
    }

    for (const entity of entities) {
        const linkedEntities = [...entity.getLinkedEntities(true), entity.page]
        const references = linkedEntities.filter(notExcluded)

        for (const ref of references) {
            addReferenceToGroup(ref.uid, entity)
            addReferencesFromHierarchy(ref, entity)

            addReferencesBasedOnAttributes.forEach(attribute => addReferencesFromAttribute(ref, entity, attribute))
        }
    }
    return referenceGroups
}

const getValues = (largestGroup: Map<string, RoamEntity>) => Array.from(largestGroup.values())

/**
 * take the largest group out,
 * and remove its members from all other groups, which would re-balance the groups
 * also a good place to find the wholly subsumed groups (they'd end up empty)
 *
 * given how this goes, probably doesn't really make sense to sort the sets or something, plausibly heap would help but also as likely to require too much updating
 */
function deduplicateAndSortGroups(
    referenceGroups: Map<string, Map<string, RoamEntity>>,
    groupPriorities: Record<'high' | 'low', RegExp[]>,
) {
    const groupsByPriorities = groupGroupsByPriorities(referenceGroups, groupPriorities) as Record<Priority, [string, Map<string, RoamEntity>][]>
    console.log({groupsByPriorities})

    const result: Array<readonly [string, RoamEntity[]]> = []

    function consumeFrom(priorityGroup: Map<string, Map<string, RoamEntity>>, minGroupSize: number = 1) {
        while (referenceGroups.size && priorityGroup.size) {
            const [referenceUid, largestGroup] = pickLargest(priorityGroup)
            if (largestGroup.size < minGroupSize) break

            result.push([referenceUid, getValues(largestGroup)] as const)

            priorityGroup.delete(referenceUid)
            referenceGroups.delete(referenceUid)

            removeGroupEntriesFromOtherGroups(referenceGroups, largestGroup)
        }
    }

    consumeFrom(new Map(groupsByPriorities.high))
    consumeFrom(new Map(groupsByPriorities.default), 2)
    consumeFrom(new Map(groupsByPriorities.low))

    // consume the rest
    consumeFrom(referenceGroups)

    return new Map<string, RoamEntity[]>([...result])
}

function removeGroupEntriesFromOtherGroups(
    referenceGroups: Map<string, Map<string, RoamEntity>>,
    largestGroup: Map<string, RoamEntity>,
) {
    for (const [_, group] of referenceGroups) {
        // todo remove empty groups
        if (group.size === 0) continue

        for (const uid of largestGroup.keys()) {
            group.delete(uid)
        }
    }
}

const groupGroupsByPriorities = (
    referenceGroups: Map<string, Map<string, RoamEntity>>,
    groupPriorities: Record<'high' | 'low', RegExp[]>,
) =>
    groupBy([...referenceGroups],
        ([refUid]: [string, Map<string, RoamEntity>]): Priority => {
            const ref = RoamEntity.fromUid(refUid)!
            if (groupPriorities.high.some(it => it.test(ref.text))) return 'high'
            if (groupPriorities.low.some(it => it.test(ref.text))) return 'low'
            return 'default'
        })

const pickLargest = (referenceGroups: Map<string, Map<string, RoamEntity>>) =>
    [...referenceGroups.entries()]
        .reduce((a, b) => a[1].size > b[1].size ? a : b)

export function matchesFilter(entity: RoamEntity, filters: ReferenceFilter) {
    const refs = entity.getLinkedEntities(true)

    const matchesAllIncludes = filters.includes.every((f) => refs.some((r) => r.text === f))
    const matchesNoRemoves = filters.removes.every((f) => !refs.some((r) => r.text === f))

    return matchesAllIncludes && matchesNoRemoves
}
