import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useStudents } from '../context/StudentContext';
import { useHostel } from '../context/HostelContext';
import { calculateFine, getFineStatus, getGraceEndDate } from '../lib/fineUtils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import {
    IndianRupee, Calendar, CheckCircle2, AlertCircle, Clock,
    ChevronLeft, ChevronRight, Loader2, Info
} from 'lucide-react';
import { cn } from '../lib/utils';
import toast, { Toaster } from 'react-hot-toast';

// ---------- helpers ----------
function formatDate(isoStr) {
    if (!isoStr) return '—';
    return new Date(isoStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }) {
    const map = {
        paid: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700' },
        overdue: { label: 'Overdue', cls: 'bg-red-100 text-red-700' },
        grace: { label: 'Within Grace', cls: 'bg-amber-100 text-amber-700' },
        'no-due-date': { label: 'No Due Date', cls: 'bg-gray-100 text-gray-500' },
    };
    const { label, cls } = map[status] || map['no-due-date'];
    return (
        <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold', cls)}>
            {label}
        </span>
    );
}

// ---------- main component ----------
export default function AdminFines() {
    const { user } = useAuth();
    const { students } = useStudents();
    const { messRate } = useHostel();

    // Month navigation
    const now = new Date();
    const [selectedDate, setSelectedDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthKey = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}`;
    const isCurrentMonth = selectedDate.getFullYear() === now.getFullYear() && selectedDate.getMonth() === now.getMonth();
    const monthLabel = selectedDate.toLocaleString('default', { month: 'long', year: 'numeric' });

    // Fine settings for selected month
    const [fineSettings, setFineSettings] = useState(null); // { due_date }
    const [loadingSettings, setLoadingSettings] = useState(true);

    // Leaves map for the month (for bill calculation)
    const [rangeLeaves, setRangeLeaves] = useState({});
    const [loadingLeaves, setLoadingLeaves] = useState(false);

    // Payment records: { [mess_number]: { paid_at, fine_amount_at_payment } }
    const [payments, setPayments] = useState({});
    const [loadingPayments, setLoadingPayments] = useState(false);

    // Tracking which rows are being saved
    const [markingPaid, setMarkingPaid] = useState({});

    // ---------- fetch fine settings ----------
    useEffect(() => {
        const fetch = async () => {
            setLoadingSettings(true);
            const { data } = await supabase
                .from('fine_settings')
                .select('due_date')
                .eq('month', monthKey)
                .maybeSingle();
            setFineSettings(data || null);
            setLoadingSettings(false);
        };
        fetch();
    }, [monthKey]);

    // ---------- fetch leaves for bill calculation ----------
    useEffect(() => {
        if (!user?.hostelId) return;
        const fetchLeaves = async () => {
            setLoadingLeaves(true);
            const [y, m] = monthKey.split('-').map(Number);
            const daysInMonth = new Date(y, m, 0).getDate();
            const sDate = `${monthKey}-01`;
            const eDate = `${monthKey}-${String(daysInMonth).padStart(2, '0')}`;

            const PAGE_SIZE = 1000;
            let allData = [];
            let from = 0;
            let keepFetching = true;

            while (keepFetching) {
                const { data, error } = await supabase
                    .from('leaves')
                    .select('leave_date, mess_number')
                    .eq('status', 'Approved')
                    .eq('hostel_id', user.hostelId)
                    .gte('leave_date', sDate)
                    .lte('leave_date', eDate)
                    .range(from, from + PAGE_SIZE - 1);

                if (error) { console.error(error); break; }
                if (data?.length) allData = allData.concat(data);
                if (!data || data.length < PAGE_SIZE) keepFetching = false;
                else from += PAGE_SIZE;
            }

            const leavesMap = {};
            allData.forEach(record => {
                if (!leavesMap[record.leave_date]) leavesMap[record.leave_date] = [];
                leavesMap[record.leave_date].push(record.mess_number);
            });
            setRangeLeaves(leavesMap);
            setLoadingLeaves(false);
        };
        fetchLeaves();
    }, [user?.hostelId, monthKey]);

    // ---------- fetch payment records ----------
    const fetchPayments = useCallback(async () => {
        if (!user?.hostelId) return;
        setLoadingPayments(true);
        const { data, error } = await supabase
            .from('fine_payments')
            .select('mess_number, paid_at, fine_amount_at_payment, paid_by')
            .eq('hostel_id', user.hostelId)
            .eq('month', monthKey);

        if (!error && data) {
            const map = {};
            data.forEach(p => { map[p.mess_number] = p; });
            setPayments(map);
        }
        setLoadingPayments(false);
    }, [user?.hostelId, monthKey]);

    useEffect(() => { fetchPayments(); }, [fetchPayments]);

    // ---------- bill calc helpers ----------
    const [y, m] = monthKey.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();

    const getLeaveCount = (messNumber) => {
        let count = 0;
        for (let d = 1; d <= daysInMonth; d++) {
            const dateKey = `${monthKey}-${String(d).padStart(2, '0')}`;
            if ((rangeLeaves[dateKey] || []).includes(messNumber)) count++;
        }
        return count;
    };

    // Reference date: today for current month, last day of month for past months
    const referenceDate = isCurrentMonth ? now : new Date(y, m, 0);

    // ---------- mark as paid ----------
    const handleMarkPaid = async (student, currentFine) => {
        setMarkingPaid(prev => ({ ...prev, [student.messNumber]: true }));

        const { error } = await supabase
            .from('fine_payments')
            .insert({
                mess_number: student.messNumber,
                hostel_id: user.hostelId,
                month: monthKey,
                fine_amount_at_payment: currentFine,
                paid_by: user.name || user.email,
            });

        if (error) {
            toast.error('Failed to mark as paid: ' + error.message);
        } else {
            toast.success(`${student.name} marked as paid`);
            await fetchPayments();
        }
        setMarkingPaid(prev => ({ ...prev, [student.messNumber]: false }));
    };

    // ---------- computed student rows ----------
    const studentRows = students.map(student => {
        const leaveCount = getLeaveCount(student.messNumber);
        const billableDays = daysInMonth - leaveCount;
        const messBill = billableDays * messRate;

        const payment = payments[student.messNumber];
        const isPaid = !!payment;
        const fineAtPayment = payment?.fine_amount_at_payment ?? 0;
        const fine = calculateFine(fineSettings?.due_date || null, referenceDate, isPaid, fineAtPayment);
        const status = getFineStatus(fineSettings?.due_date || null, referenceDate, isPaid);
        const total = messBill + fine;

        return { ...student, leaveCount, billableDays, messBill, fine, status, total, isPaid, payment };
    });

    // ---------- summary stats ----------
    const paidCount = studentRows.filter(s => s.isPaid).length;
    const overdueCount = studentRows.filter(s => s.status === 'overdue').length;
    const graceCount = studentRows.filter(s => s.status === 'grace').length;
    const totalOutstanding = studentRows.filter(s => !s.isPaid).reduce((sum, s) => sum + s.total, 0);
    const totalFinesCollected = studentRows.filter(s => s.isPaid).reduce((sum, s) => sum + (s.payment?.fine_amount_at_payment ?? 0), 0);

    const graceEndDate = fineSettings?.due_date ? getGraceEndDate(fineSettings.due_date) : null;

    const isLoading = loadingSettings || loadingLeaves || loadingPayments;

    return (
        <div className="space-y-6 animate-fade-in">
            <Toaster />

            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Fines & Payments</h1>
                    <p className="text-gray-500 mt-1">Track and manage mess fee payments and fines.</p>
                </div>
                {/* Month Navigator */}
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={() => setSelectedDate(new Date(y, m - 2, 1))}>
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <div className="font-semibold text-gray-900 min-w-[150px] text-center text-sm">{monthLabel}</div>
                    <Button variant="outline" size="icon" disabled={isCurrentMonth} onClick={() => setSelectedDate(new Date(y, m, 1))}>
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            {/* No due date banner */}
            {!loadingSettings && !fineSettings && (
                <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-5 py-4 text-sm text-blue-700">
                    <Info className="w-5 h-5 shrink-0 text-blue-500" />
                    <span>
                        No payment due date has been set for <strong>{monthLabel}</strong>.
                        Go to <strong>Settings → Fine & Payment Settings</strong> to configure one.
                    </span>
                </div>
            )}

            {/* Due date info bar */}
            {fineSettings && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-orange-50 border border-orange-100 rounded-xl px-5 py-3 text-sm">
                    <div className="flex items-center gap-2 text-orange-800">
                        <Calendar className="w-4 h-4" />
                        <span className="font-medium">Due:</span>
                        <span>{formatDate(fineSettings.due_date)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-orange-800">
                        <Clock className="w-4 h-4" />
                        <span className="font-medium">Grace ends:</span>
                        <span>{graceEndDate ? formatDate(graceEndDate.toISOString().slice(0, 10)) : '—'}</span>
                    </div>
                    <div className="text-orange-600 text-xs">₹15 increment every 4 days starting 4 days after grace period</div>
                </div>
            )}

            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: 'Paid', value: paidCount, sub: 'students', icon: CheckCircle2, color: 'emerald' },
                    { label: 'Overdue', value: overdueCount, sub: 'students', icon: AlertCircle, color: 'red' },
                    { label: 'In Grace', value: graceCount, sub: 'students', icon: Clock, color: 'amber' },
                    { label: 'Outstanding', value: `₹${totalOutstanding.toLocaleString()}`, sub: 'total unpaid', icon: IndianRupee, color: 'indigo' },
                ].map(({ label, value, sub, icon: Icon, color }) => (
                    <Card key={label} className="border-gray-200 shadow-sm">
                        <CardContent className="p-5">
                            <div className="flex items-center gap-3">
                                <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                                    color === 'emerald' && 'bg-emerald-50',
                                    color === 'red' && 'bg-red-50',
                                    color === 'amber' && 'bg-amber-50',
                                    color === 'indigo' && 'bg-indigo-50',
                                )}>
                                    <Icon className={cn('w-4 h-4',
                                        color === 'emerald' && 'text-emerald-600',
                                        color === 'red' && 'text-red-600',
                                        color === 'amber' && 'text-amber-600',
                                        color === 'indigo' && 'text-indigo-600',
                                    )} />
                                </div>
                                <div>
                                    <p className="text-xl font-bold text-gray-900">{value}</p>
                                    <p className="text-xs text-gray-500">{label} · {sub}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Student Table */}
            <Card className="border-gray-200 shadow-sm overflow-hidden">
                <CardHeader className="bg-gray-50/50 border-b border-gray-100">
                    <CardTitle className="text-lg">Student Fine Overview — {monthLabel}</CardTitle>
                    <CardDescription>
                        {fineSettings
                            ? `Mess fee + fine breakdown. Mark students as paid once they have settled their dues.`
                            : 'Set a due date in Settings to enable fine tracking.'}
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="flex items-center justify-center gap-2 py-16 text-gray-500">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>Loading...</span>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-50 text-gray-700 font-medium border-b border-gray-200">
                                    <tr>
                                        <th className="px-5 py-4">Mess No</th>
                                        <th className="px-5 py-4">Name</th>
                                        <th className="px-5 py-4 text-right">Mess Bill (₹)</th>
                                        <th className="px-5 py-4 text-right">Fine (₹)</th>
                                        <th className="px-5 py-4 text-right font-bold">Total (₹)</th>
                                        <th className="px-5 py-4 text-center">Status</th>
                                        <th className="px-5 py-4 text-center">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 bg-white">
                                    {studentRows.map((student) => (
                                        <tr
                                            key={student.id}
                                            className={cn(
                                                'transition-colors',
                                                student.isPaid ? 'bg-emerald-50/30 hover:bg-emerald-50/50' : 'hover:bg-gray-50/50'
                                            )}
                                        >
                                            <td className="px-5 py-4 font-medium text-gray-900">{student.messNumber}</td>
                                            <td className="px-5 py-4 text-gray-700">
                                                <div>{student.name}</div>
                                                {student.isPaid && (
                                                    <div className="text-xs text-gray-400 mt-0.5">
                                                        Paid {new Date(student.payment.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                                        {student.payment.paid_by && ` · by ${student.payment.paid_by}`}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-5 py-4 text-right text-gray-700">₹{student.messBill.toLocaleString()}</td>
                                            <td className={cn('px-5 py-4 text-right font-medium',
                                                student.fine > 0 ? 'text-red-600' : 'text-gray-400'
                                            )}>
                                                {student.fine > 0 ? `₹${student.fine.toLocaleString()}` : '—'}
                                            </td>
                                            <td className="px-5 py-4 text-right font-bold text-gray-900">
                                                ₹{student.total.toLocaleString()}
                                            </td>
                                            <td className="px-5 py-4 text-center">
                                                <StatusBadge status={student.status} />
                                            </td>
                                            <td className="px-5 py-4 text-center">
                                                {student.isPaid ? (
                                                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                                                        <CheckCircle2 className="w-3.5 h-3.5" /> Done
                                                    </span>
                                                ) : (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={markingPaid[student.messNumber]}
                                                        onClick={() => handleMarkPaid(student, student.fine)}
                                                        className="text-xs h-8 border-emerald-500 text-emerald-700 hover:bg-emerald-50 gap-1"
                                                    >
                                                        {markingPaid[student.messNumber]
                                                            ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving...</>
                                                            : <><CheckCircle2 className="w-3 h-3" /> Mark Paid</>
                                                        }
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                {/* Footer totals */}
                                <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                                    <tr>
                                        <td className="px-5 py-4" />
                                        <td className="px-5 py-4 font-bold text-gray-900">Grand Total</td>
                                        <td className="px-5 py-4 text-right font-bold text-gray-700">
                                            ₹{studentRows.reduce((s, r) => s + r.messBill, 0).toLocaleString()}
                                        </td>
                                        <td className="px-5 py-4 text-right font-bold text-red-600">
                                            ₹{studentRows.reduce((s, r) => s + r.fine, 0).toLocaleString()}
                                        </td>
                                        <td className="px-5 py-4 text-right font-bold text-gray-900 text-base">
                                            ₹{studentRows.reduce((s, r) => s + r.total, 0).toLocaleString()}
                                        </td>
                                        <td className="px-5 py-4" />
                                        <td className="px-5 py-4" />
                                    </tr>
                                </tfoot>
                            </table>

                            {studentRows.length === 0 && (
                                <div className="py-16 text-center text-gray-500">
                                    <IndianRupee className="w-10 h-10 mx-auto text-gray-300 mb-3" />
                                    <p>No students found.</p>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
