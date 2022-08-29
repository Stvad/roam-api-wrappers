import getPageUidByPageTitle from 'roamjs-components/queries/getPageUidByPageTitle'
import 'roamjs-components/types'
import {getActiveEditElement} from '../dom'

export const openPageInSidebar = (name: string) =>
    window.roamAlphaAPI.ui.rightSidebar.addWindow({
        window: {
            'block-uid': getPageUidByPageTitle(name),
            type: 'block',
        },
    })

export const getSelectionInFocusedBlock = () => ({
    start: getActiveEditElement()?.selectionStart,
    end: getActiveEditElement()?.selectionEnd,
})
