/*
Copyright 2022 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { Wysiwyg, WysiwygEvent } from "@matrix-org/matrix-wysiwyg";
import { useCallback } from "react";
import { MatrixClient, MatrixEvent } from "matrix-js-sdk/src/matrix";

import { useSettingValue } from "../../../../../hooks/useSettings";
import { getKeyBindingsManager } from "../../../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../../../accessibility/KeyboardShortcuts";
import { findEditableEvent } from "../../../../../utils/EventUtils";
import dis from "../../../../../dispatcher/dispatcher";
import { Action } from "../../../../../dispatcher/actions";
import { useRoomContext } from "../../../../../contexts/RoomContext";
import { IRoomState } from "../../../../structures/RoomView";
import { ComposerContextState, useComposerContext } from "../ComposerContext";
import EditorStateTransfer from "../../../../../utils/EditorStateTransfer";
import { useMatrixClientContext } from "../../../../../contexts/MatrixClientContext";
import { isCaretAtEnd, isCaretAtStart } from "../utils/selection";

export function useInputEventProcessor(
    onSend: () => void,
    initialContent?: string,
): (event: WysiwygEvent, composer: Wysiwyg, editor: HTMLElement) => WysiwygEvent | null {
    const roomContext = useRoomContext();
    const composerContext = useComposerContext();
    const mxClient = useMatrixClientContext();
    const isCtrlEnter = useSettingValue<boolean>("MessageComposerInput.ctrlEnterToSend");

    return useCallback(
        (event: WysiwygEvent, composer: Wysiwyg, editor: HTMLElement) => {
            if (event instanceof ClipboardEvent) {
                return event;
            }

            const send = (): void => {
                event.stopPropagation?.();
                event.preventDefault?.();
                onSend();
            };

            const isKeyboardEvent = event instanceof KeyboardEvent;
            if (isKeyboardEvent) {
                return handleKeyboardEvent(
                    event,
                    send,
                    initialContent,
                    composer,
                    editor,
                    roomContext,
                    composerContext,
                    mxClient,
                );
            } else {
                return handleInputEvent(event, send, isCtrlEnter);
            }
        },
        [isCtrlEnter, onSend, initialContent, roomContext, composerContext, mxClient],
    );
}

type Send = () => void;

function handleKeyboardEvent(
    event: KeyboardEvent,
    send: Send,
    initialContent: string | undefined,
    composer: Wysiwyg,
    editor: HTMLElement,
    roomContext: IRoomState,
    composerContext: ComposerContextState,
    mxClient: MatrixClient,
): KeyboardEvent | null {
    const { editorStateTransfer } = composerContext;
    const isEditorModified = initialContent !== composer.content();
    const action = getKeyBindingsManager().getMessageComposerAction(event);

    switch (action) {
        case KeyBindingAction.SendMessage:
            send();
            return null;
        case KeyBindingAction.EditPrevMessage: {
            // If not in edition
            // Or if the caret is not at the beginning of the editor
            // Or the editor is modified
            if (!editorStateTransfer || !isCaretAtStart(editor) || isEditorModified) {
                break;
            }

            dispatchEditEvent(event, false, editorStateTransfer, roomContext, mxClient);
            return null;
        }
        case KeyBindingAction.EditNextMessage: {
            // If not in edition
            // Or if the caret is not at the end of the editor
            // Or the editor is modified
            if (!editorStateTransfer || !isCaretAtEnd(editor) || isEditorModified) {
                break;
            }

            dispatchEditEvent(event, true, editorStateTransfer, roomContext, mxClient);
            // TODO cancel edit if no newEvent
            break;
        }
    }

    return event;
}

function dispatchEditEvent(
    event: KeyboardEvent,
    isForward: boolean,
    editorStateTransfer: EditorStateTransfer,
    roomContext: IRoomState,
    mxClient: MatrixClient,
): void {
    const foundEvents = getEventsFromEditorStateTransfer(editorStateTransfer, roomContext, mxClient);
    if (!foundEvents) {
        return;
    }

    const newEvent = findEditableEvent({
        events: foundEvents,
        isForward,
        fromEventId: editorStateTransfer.getEvent().getId(),
    });
    if (newEvent) {
        dis.dispatch({
            action: Action.EditEvent,
            event: newEvent,
            timelineRenderingType: roomContext.timelineRenderingType,
        });
        event.stopPropagation();
        event.preventDefault();
    }
}

// From EditMessageComposer private get events(): MatrixEvent[]
function getEventsFromEditorStateTransfer(
    editorStateTransfer: EditorStateTransfer,
    roomContext: IRoomState,
    mxClient: MatrixClient,
): MatrixEvent[] | undefined {
    const liveTimelineEvents = roomContext.liveTimeline?.getEvents();
    if (!liveTimelineEvents) {
        return;
    }

    const roomId = editorStateTransfer.getEvent().getRoomId();
    if (!roomId) {
        return;
    }

    const room = mxClient.getRoom(roomId);
    if (!room) {
        return;
    }

    const pendingEvents = room.getPendingEvents();
    const isInThread = Boolean(editorStateTransfer.getEvent().getThread());
    return liveTimelineEvents.concat(isInThread ? [] : pendingEvents);
}

type InputEvent = Exclude<WysiwygEvent, KeyboardEvent | ClipboardEvent>;

function handleInputEvent(event: InputEvent, send: Send, isCtrlEnter: boolean): InputEvent | null {
    switch (event.inputType) {
        case "insertParagraph":
            if (!isCtrlEnter) {
                send();
            }
            return null;
        case "sendMessage":
            if (isCtrlEnter) {
                send();
            }
            return null;
    }

    return event;
}
