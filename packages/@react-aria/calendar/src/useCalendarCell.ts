/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {CalendarDate, isEqualDay, isSameDay, isToday} from '@internationalized/date';
import {CalendarState, RangeCalendarState} from '@react-stately/calendar';
import {focusWithoutScrolling} from '@react-aria/utils';
import {HTMLAttributes, RefObject, useEffect, useMemo, useRef} from 'react';
// @ts-ignore
import intlMessages from '../intl/*.json';
import {mergeProps} from '@react-aria/utils';
import {useDateFormatter, useMessageFormatter} from '@react-aria/i18n';
import {usePress} from '@react-aria/interactions';

export interface AriaCalendarCellProps {
  /** The date that this cell represents. */
  date: CalendarDate,
  /**
   * Whether the cell is disabled. By default, this is determined by the
   * Calendar's `minValue`, `maxValue`, and `isDisabled` props.
   */
  isDisabled?: boolean
}

interface CalendarCellAria {
  /** Props for the grid cell element (e.g. `<td>`). */
  cellProps: HTMLAttributes<HTMLElement>,
  /** Props for the button element within the cell. */
  buttonProps: HTMLAttributes<HTMLElement>,
  /** Whether the cell is currently being pressed. */
  isPressed: boolean,
  /** Whether the cell is selected. */
  isSelected: boolean,
  /** Whether the cell is focused. */
  isFocused: boolean,
  /**
   * Whether the cell is disabled, according to the calendar's `minValue`, `maxValue`, and `isDisabled` props.
   * Disabled dates are not focusable, and cannot be selected by the user. They are typically
   * displayed with a dimmed appearance.
   */
  isDisabled: boolean,
  /**
   * Whether the cell is unavailable, according to the calendar's `isDateUnavailable` prop. Unavailable dates remain
   * focusable, but cannot be selected by the user. They should be displayed with a visual affordance to indicate they
   * are unavailable, such as a different color or a strikethrough.
   *
   * Note that because they are focusable, unavailable dates must meet a 4.5:1 color contrast ratio,
   * [as defined by WCAG](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html).
   */
  isUnavailable: boolean,
  /**
   * Whether the cell is outside the visible range of the calendar.
   * For example, dates before the first day of a month in the same week.
   */
  isOutsideVisibleRange: boolean,
  /** The day number formatted according to the current locale. */
  formattedDate: string
}

/**
 * Provides the behavior and accessibility implementation for a calendar cell component.
 * A calendar cell displays a date cell within a calendar grid which can be selected by the user.
 */
export function useCalendarCell(props: AriaCalendarCellProps, state: CalendarState | RangeCalendarState, ref: RefObject<HTMLElement>): CalendarCellAria {
  let {date, isDisabled} = props;
  let formatMessage = useMessageFormatter(intlMessages);
  let dateFormatter = useDateFormatter({
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    era: date.calendar.identifier !== 'gregory' ? 'long' : undefined,
    timeZone: state.timeZone
  });
  let isSelected = state.isSelected(date);
  let isFocused = state.isCellFocused(date);
  isDisabled = isDisabled || state.isCellDisabled(date);
  let isUnavailable = state.isCellUnavailable(date);
  let isSelectable = !isDisabled && !isUnavailable;

  // For performance, reuse the same date object as before if the new date prop is the same.
  // This allows subsequent useMemo results to be reused.
  let lastDate = useRef(null);
  if (lastDate.current && isEqualDay(date, lastDate.current)) {
    date = lastDate.current;
  }

  lastDate.current = date;

  let nativeDate = useMemo(() => date.toDate(state.timeZone), [date, state.timeZone]);

  // aria-label should be localize Day of week, Month, Day and Year without Time.
  let isDateToday = isToday(date, state.timeZone);
  let label = useMemo(() => {
    if (isDateToday) {
      // If date is today, set appropriate string depending on selected state:
      return formatMessage(isSelected ? 'todayDateSelected' : 'todayDate', {
        date: nativeDate
      });
    } else if (isSelected) {
      // If date is selected but not today:
      return formatMessage('dateSelected', {
        date: nativeDate
      });
    }

    return dateFormatter.format(nativeDate);
  }, [dateFormatter, nativeDate, formatMessage, isSelected, isDateToday]);

  // When a cell is focused and this is a range calendar, add a prompt to help
  // screenreader users know that they are in a range selection mode.
  if ('anchorDate' in state && isFocused && !state.isReadOnly && isSelectable) {
    let rangeSelectionPrompt = '';

    // If selection has started add "click to finish selecting range"
    if (state.anchorDate) {
      rangeSelectionPrompt = formatMessage('finishRangeSelectionPrompt');
    // Otherwise, add "click to start selecting range" prompt
    } else {
      rangeSelectionPrompt = formatMessage('startRangeSelectionPrompt');
    }

    // Append to aria-label
    if (rangeSelectionPrompt) {
      label = `${label} (${rangeSelectionPrompt})`;
    }
  }

  let isAnchorPressed = useRef(false);
  let isRangeBoundaryPressed = useRef(false);
  let touchDragTimerRef = useRef(null);
  let {pressProps, isPressed} = usePress({
    // When dragging to select a range, we don't want dragging over the original anchor
    // again to trigger onPressStart. Cancel presses immediately when the pointer exits.
    shouldCancelOnPointerExit: 'anchorDate' in state && !!state.anchorDate,
    preventFocusOnPress: true,
    isDisabled: !isSelectable,
    onPressStart(e) {
      if (state.isReadOnly) {
        state.setFocusedDate(date);
        return;
      }

      if ('highlightedRange' in state && !state.anchorDate && (e.pointerType === 'mouse' || e.pointerType === 'touch')) {
        // Allow dragging the start or end date of a range to modify it
        // rather than starting a new selection.
        if (state.highlightedRange) {
          if (isSameDay(date, state.highlightedRange.start)) {
            state.setAnchorDate(state.highlightedRange.end);
            state.setFocusedDate(date);
            state.setDragging(true);
            isRangeBoundaryPressed.current = true;
            return;
          } else if (isSameDay(date, state.highlightedRange.end)) {
            state.setAnchorDate(state.highlightedRange.start);
            state.setFocusedDate(date);
            state.setDragging(true);
            isRangeBoundaryPressed.current = true;
            return;
          }
        }

        let startDragging = () => {
          state.setDragging(true);
          touchDragTimerRef.current = null;

          state.selectDate(date);
          state.setFocusedDate(date);
          isAnchorPressed.current = true;
        };

        // Start selection on mouse/touch down so users can drag to select a range.
        // On touch, delay dragging to determine if the user really meant to scroll.
        if (e.pointerType === 'touch') {
          touchDragTimerRef.current = setTimeout(startDragging, 200);
        } else {
          startDragging();
        }
      }
    },
    onPressEnd() {
      isRangeBoundaryPressed.current = false;
      isAnchorPressed.current = false;
      clearTimeout(touchDragTimerRef.current);
      touchDragTimerRef.current = null;
    },
    onPress() {
      // For non-range selection, always select on press up.
      if (!('anchorDate' in state) && !state.isReadOnly) {
        state.selectDate(date);
        state.setFocusedDate(date);
      }
    },
    onPressUp(e) {
      if (state.isReadOnly) {
        return;
      }

      // If the user tapped quickly, the date won't be selected yet and the
      // timer will still be in progress. In this case, select the date on touch up.
      // Timer is cleared in onPressEnd.
      if ('anchorDate' in state && touchDragTimerRef.current) {
        state.selectDate(date);
        state.setFocusedDate(date);
      }

      if ('anchorDate' in state) {
        if (isRangeBoundaryPressed.current) {
          // When clicking on the start or end date of an already selected range,
          // start a new selection on press up to also allow dragging the date to
          // change the existing range.
          state.setAnchorDate(date);
        } else if (state.anchorDate && !isAnchorPressed.current) {
          // When releasing a drag or pressing the end date of a range, select it.
          state.selectDate(date);
          state.setFocusedDate(date);
        } else if (e.pointerType === 'keyboard' && !state.anchorDate) {
          // For range selection, auto-advance the focused date by one if using keyboard.
          // This gives an indication that you're selecting a range rather than a single date.
          // For mouse, this is unnecessary because users will see the indication on hover. For screen readers,
          // there will be an announcement to "click to finish selecting range" (above).
          state.selectDate(date);
          let nextDay = date.add({days: 1});
          if (state.isInvalid(nextDay)) {
            nextDay = date.subtract({days: 1});
          }
          if (!state.isInvalid(nextDay)) {
            state.setFocusedDate(nextDay);
          }
        } else if (e.pointerType === 'virtual') {
          // For screen readers, just select the date on click.
          state.selectDate(date);
          state.setFocusedDate(date);
        }
      }
    }
  });

  let tabIndex = null;
  if (!isDisabled) {
    tabIndex = isSameDay(date, state.focusedDate) ? 0 : -1;
  }

  // Focus the button in the DOM when the state updates.
  useEffect(() => {
    if (isFocused && ref.current) {
      focusWithoutScrolling(ref.current);
    }
  }, [isFocused, ref]);

  let cellDateFormatter = useDateFormatter({
    day: 'numeric',
    timeZone: state.timeZone,
    calendar: date.calendar.identifier
  });

  let formattedDate = useMemo(() => cellDateFormatter.format(nativeDate), [cellDateFormatter, nativeDate]);

  return {
    cellProps: {
      role: 'gridcell',
      'aria-disabled': !isSelectable || null,
      'aria-selected': isSelectable ? isSelected : null
    },
    buttonProps: mergeProps(pressProps, {
      onFocus() {
        if (!isDisabled) {
          state.setFocusedDate(date);
        }
      },
      tabIndex,
      role: 'button',
      'aria-disabled': !isSelectable || null,
      'aria-label': label,
      onPointerEnter(e) {
        // Highlight the date on hover or drag over a date when selecting a range.
        if ('highlightDate' in state && (e.pointerType !== 'touch' || state.isDragging) && isSelectable) {
          state.highlightDate(date);
        }
      },
      onPointerDown(e) {
        // This is necessary on touch devices to allow dragging
        // outside the original pressed element.
        // (JSDOM does not support this)
        if ('releasePointerCapture' in e.target) {
          e.target.releasePointerCapture(e.pointerId);
        }
      },
      onContextMenu(e) {
        // Prevent context menu on long press.
        e.preventDefault();
      }
    }),
    isPressed,
    isFocused,
    isSelected,
    isDisabled,
    isUnavailable,
    isOutsideVisibleRange: date.compare(state.visibleRange.start) < 0 || date.compare(state.visibleRange.end) > 0,
    formattedDate
  };
}
