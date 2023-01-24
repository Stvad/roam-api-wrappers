import {RoamEntity} from './index'

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
]
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
    // todo to work as expected, this also needs to take parent references into the account
    // todo when we exclude all the things - just return one group
    // todo potentially special handling for hierarchies (e.g. wcs/x and wcs/y should be grouped together)
    // todo how important is dedup? (would it actually be better to show a few larger groups that have overlap?)
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

    for (const entity of entities) {
        // todo also potentially include the page it's on as it also counts as a reference
        const linkedEntities = entity.getLinkedEntities(true)
        const references = linkedEntities.filter(notExcluded)
        console.log({entity, references})
        const referenceUids = references.map(it => it.uid)

        for (const uid of referenceUids) {
            addReferenceToGroup(uid, entity)
        }
    }


    console.log({referenceGroups})

    /**
     * take the largest group out, then remove all of its members from the unassignedEntities set
     * and remove it's members from all other groups, which would rebalance the groups
     * also a good place to find the wholly subsumed groups (they'd end up empty)
     *
     * given how this goes, probably doesn't really make sense to sort the sets or something, plausibly heap would help but also as likely to require too much updating
     *
     */

    // const groups = Array.from(referenceGroups.values())
    const result = []

    while (referenceGroups.size) {
        const [referenceUid, group] = [...referenceGroups.entries()].reduce((a, b) => a[1].size > b[1].size ? a : b)

        const groupEntities = Array.from(group.values())
        const groupEntitiesUids = group.keys()
        result.push([referenceUid, groupEntities] as const)

        for (const [_, group] of referenceGroups) {
            // todo remove empty groups
            if (group.size === 0) continue

            for (const uid of groupEntitiesUids) {
                group.delete(uid)
            }
        }
        referenceGroups.delete(referenceUid)
    }

    return new Map<string, RoamEntity[]>(result)
}
