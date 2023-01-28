import {Page, RoamEntity} from './index'
import {ReferenceFilter} from './types'
import {RoamDate} from '../date'

export const defaultExclusions = [
    /^ptr$/,
    /^otter\.ai\/transcript$/,
    /^TODO$/,
    /^DONE$/,
    /^factor$/,
    /^interval$/,
    /^\[\[factor]]:.+/,
    /^\[\[interval]]:.+/,
    /^isa$/,
    /^reflection$/,
    RoamDate.onlyPageTitleRegex,
]

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
) => {
    // todo allow passing prioritized groups (e.g. `i`, that get assembled first if present),
    //  though also need to make sure that they are later not filtered out if even below the size threshold)

    // todo to work as expected, this also needs to take parent references into the account
    // todo when we exclude all the things - just return one group
    // todo how important is dedup? (would it actually be better to show a few larger groups that have overlap?)
    // todo merge groups that overlap exactly
    const referenceGroups = buildReferenceGroups(entities, dontGroupReferencesTo)

    return deduplicateAndSortGroups(referenceGroups)
}

function  buildReferenceGroups(entities: RoamEntity[], dontGroupReferencesTo: RegExp[]) {
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
        topOfHierarchy && addReferenceToGroup(topOfHierarchy.uid, entity)
    }

    function addReferencesFromAttribute(baseReference: RoamEntity, entity: RoamEntity, attributte: string) {
        const isNotAttributeReference = (it: RoamEntity) => it.text !== attributte

        baseReference.firstAttributeBlock(attributte)
            ?.linkedEntities.filter(isNotAttributeReference)
            ?.forEach(ref => addReferenceToGroup(ref.uid, entity))
    }

    for (const entity of entities) {
        const linkedEntities = [...entity.getLinkedEntities(true), entity.page]
        const references = linkedEntities.filter(notExcluded)

        for (const ref of references) {
            addReferenceToGroup(ref.uid, entity)
            // in addition to hierarchy this should take types into account (isa::stuff)
            addReferencesFromHierarchy(ref, entity)
            addReferencesFromAttribute(ref, entity, 'group with')
        }
    }
    return referenceGroups
}

/**
 * take the largest group out,
 * and remove its members from all other groups, which would re-balance the groups
 * also a good place to find the wholly subsumed groups (they'd end up empty)
 *
 * given how this goes, probably doesn't really make sense to sort the sets or something, plausibly heap would help but also as likely to require too much updating
 */
function deduplicateAndSortGroups(referenceGroups: Map<string, Map<string, RoamEntity>>) {
    const result = []

    while (referenceGroups.size) {
        const [referenceUid, largestGroup] = pickLargest(referenceGroups)

        result.push([referenceUid, Array.from(largestGroup.values())] as const)

        referenceGroups.delete(referenceUid)

        for (const [_, group] of referenceGroups) {
            // todo remove empty groups
            if (group.size === 0) continue

            for (const uid of largestGroup.keys()) {
                group.delete(uid)
            }
        }
    }

    return new Map<string, RoamEntity[]>(result)
}

const pickLargest = (referenceGroups: Map<string, Map<string, RoamEntity>>) =>
    [...referenceGroups.entries()]
        .reduce((a, b) => a[1].size > b[1].size ? a : b)

export function matchesFilter(entity: RoamEntity, filters: ReferenceFilter) {
    const refs = entity.getLinkedEntities(true)

    const matchesAllIncludes = filters.includes.every((f) => refs.some((r) => r.text === f))
    const matchesNoRemoves = filters.removes.every((f) => !refs.some((r) => r.text === f))

    return matchesAllIncludes && matchesNoRemoves
}
