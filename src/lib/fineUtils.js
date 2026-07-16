/**
 * Fine calculation utilities.
 *
 * Fine logic:
 *  - Admin sets a due_date per month.
 *  - Grace period = due_date + 7 days (inclusive). No fine during this window.
 *  - From day 8 past due (4 days past grace end) onwards, fine = floor(daysOverdue / 4) * 15.
 *  - Fine stops accumulating once admin marks the student as paid.
 *    The frozen fine_amount_at_payment is used after that.
 */

/**
 * Returns the grace period end date (due_date + 7 days).
 * @param {string} dueDateStr - ISO date string e.g. "2026-07-05"
 * @returns {Date}
 */
export function getGraceEndDate(dueDateStr) {
    const d = new Date(dueDateStr);
    d.setDate(d.getDate() + 7);
    return d;
}

/**
 * Returns the number of days the student is past the grace period.
 * Returns 0 if still within grace.
 * @param {string} dueDateStr - ISO date string
 * @param {Date} referenceDate - Date to compare against (usually today)
 * @returns {number}
 */
export function getDaysOverdue(dueDateStr, referenceDate) {
    const graceEnd = getGraceEndDate(dueDateStr);
    // Normalize both to midnight UTC to avoid time-of-day drift
    const ref = new Date(referenceDate);
    ref.setHours(0, 0, 0, 0);
    graceEnd.setHours(0, 0, 0, 0);

    if (ref <= graceEnd) return 0;
    const msPerDay = 1000 * 60 * 60 * 24;
    return Math.floor((ref - graceEnd) / msPerDay);
}

/**
 * Calculates the fine amount in rupees.
 *
 * @param {string|null} dueDateStr - ISO date string or null if not set
 * @param {Date} referenceDate - Date to calculate against (usually today)
 * @param {boolean} isPaid - Whether the student has been marked as paid
 * @param {number} fineAtPayment - The frozen fine amount (used when isPaid = true)
 * @returns {number} - Fine in ₹
 */
export function calculateFine(dueDateStr, referenceDate, isPaid = false, fineAtPayment = 0) {
    if (!dueDateStr) return 0;
    if (isPaid) return fineAtPayment;

    const daysOverdue = getDaysOverdue(dueDateStr, referenceDate);
    if (daysOverdue === 0) return 0;

    return Math.floor(daysOverdue / 4) * 15;
}

/**
 * Returns the status of a student's fine payment.
 *
 * @param {string|null} dueDateStr - ISO date string or null
 * @param {Date} referenceDate - Date to check against
 * @param {boolean} isPaid - Whether the student has been marked as paid
 * @returns {'no-due-date' | 'paid' | 'grace' | 'overdue'}
 */
export function getFineStatus(dueDateStr, referenceDate, isPaid = false) {
    if (!dueDateStr) return 'no-due-date';
    if (isPaid) return 'paid';

    const daysOverdue = getDaysOverdue(dueDateStr, referenceDate);
    return daysOverdue === 0 ? 'grace' : 'overdue';
}
