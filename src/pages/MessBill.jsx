import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useHostel } from '../context/HostelContext';
import { calculateFine, getFineStatus, getGraceEndDate } from '../lib/fineUtils';
import {
    Receipt, Calendar, Minus, CheckCircle2, Loader2,
    ChevronLeft, ChevronRight, AlertTriangle, Info, Clock, IndianRupee
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { cn } from '../lib/utils';

// ---------- helpers ----------
function formatDate(isoStr) {
    if (!isoStr) return '—';
    return new Date(isoStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function FineStatusBanner({ status, dueDate, graceEnd, fine }) {
    if (status === 'no-due-date') {
        return (
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-700">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-500" />
                <span>Due date has not been fixed by the admin for this month.</span>
            </div>
        );
    }
    if (status === 'paid') {
        return (
            <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-sm text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                <span className="font-medium">Payment received. Your account is cleared for this month.</span>
            </div>
        );
    }
    if (status === 'grace') {
        return (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-800">
                <Clock className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                <div>
                    <p className="font-medium">You are within the grace period.</p>
                    <p className="text-xs mt-0.5 text-amber-700">
                        Pay before <strong>{formatDate(graceEnd)}</strong> to avoid fines. Due date was {formatDate(dueDate)}.
                    </p>
                </div>
            </div>
        );
    }
    if (status === 'overdue') {
        return (
            <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                <div>
                    <p className="font-medium">Payment overdue — fine of ₹{fine} has been applied.</p>
                    <p className="text-xs mt-0.5 text-red-600">
                        Due date was {formatDate(dueDate)}. Fine starts ₹15 on the 4th day overdue and increments by ₹15 every 4 days.
                    </p>
                </div>
            </div>
        );
    }
    return null;
}

// ---------- main component ----------
export default function MessBill() {
    const { user } = useAuth();
    const { messRate } = useHostel();

    const now = new Date();
    const [selectedDate, setSelectedDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
    const [monthLeaves, setMonthLeaves] = useState([]);
    const [loadingLeaves, setLoadingLeaves] = useState(false);

    // Fine-related state
    const [fineSettings, setFineSettings] = useState(null); // { due_date } or null
    const [finePayment, setFinePayment] = useState(null);   // { fine_amount_at_payment } or null
    const [loadingFine, setLoadingFine] = useState(false);

    if (!user) return <div className="p-8 text-center">Please log in to view bill.</div>;

    const currentYear = selectedDate.getFullYear();
    const currentMonth = selectedDate.getMonth(); // 0-indexed
    const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    const isCurrentMonth = currentYear === now.getFullYear() && currentMonth === now.getMonth();

    const handlePrevMonth = () => setSelectedDate(new Date(currentYear, currentMonth - 1, 1));
    const handleNextMonth = () => setSelectedDate(new Date(currentYear, currentMonth + 1, 1));

    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    // ---------- fetch leaves ----------
    useEffect(() => {
        if (!user?.hostelId || !user?.messNumber) return;
        const fetchLeaves = async () => {
            setLoadingLeaves(true);
            const startStr = `${monthKey}-01`;
            const endStr = `${monthKey}-${String(daysInMonth).padStart(2, '0')}`;
            const { data, error } = await supabase
                .from('leaves')
                .select('leave_date')
                .eq('status', 'Approved')
                .eq('hostel_id', user.hostelId)
                .eq('mess_number', user.messNumber)
                .gte('leave_date', startStr)
                .lte('leave_date', endStr);
            if (!error) setMonthLeaves(data.map(d => d.leave_date));
            else { console.error(error); setMonthLeaves([]); }
            setLoadingLeaves(false);
        };
        fetchLeaves();
    }, [user?.hostelId, user?.messNumber, monthKey, daysInMonth]);

    // ---------- fetch fine settings + payment ----------
    useEffect(() => {
        const fetchFineData = async () => {
            setLoadingFine(true);
            const [settingsRes, paymentRes] = await Promise.all([
                supabase.from('fine_settings').select('due_date').eq('month', monthKey).maybeSingle(),
                supabase.from('fine_payments')
                    .select('fine_amount_at_payment, paid_at')
                    .eq('mess_number', user.messNumber)
                    .eq('hostel_id', user.hostelId)
                    .eq('month', monthKey)
                    .maybeSingle(),
            ]);
            setFineSettings(settingsRes.data || null);
            setFinePayment(paymentRes.data || null);
            setLoadingFine(false);
        };
        if (user?.hostelId && user?.messNumber) fetchFineData();
    }, [monthKey, user?.hostelId, user?.messNumber]);

    // ---------- calculations ----------
    let leaveCount = 0;
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${monthKey}-${String(day).padStart(2, '0')}`;
        if (monthLeaves.includes(dateKey)) leaveCount++;
    }

    const activeDays = daysInMonth - leaveCount;
    const messFee = activeDays * messRate;
    const savings = leaveCount * messRate;
    const monthName = selectedDate.toLocaleString('default', { month: 'long' });

    // Fine calculation
    const isPaid = !!finePayment;
    const fineAtPayment = finePayment?.fine_amount_at_payment ?? 0;
    const referenceDate = isCurrentMonth ? now : new Date(currentYear, currentMonth + 1, 0);
    const fine = calculateFine(fineSettings?.due_date || null, referenceDate, isPaid, fineAtPayment);
    const fineStatus = getFineStatus(fineSettings?.due_date || null, referenceDate, isPaid);
    const graceEnd = fineSettings?.due_date ? getGraceEndDate(fineSettings.due_date) : null;
    const graceEndStr = graceEnd ? graceEnd.toISOString().slice(0, 10) : null;

    const totalPayable = messFee + fine;

    // Badge config
    const statusConfig = {
        paid: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700' },
        overdue: { label: 'Overdue', cls: 'bg-red-100 text-red-700' },
        grace: { label: 'Within Grace', cls: 'bg-amber-100 text-amber-700' },
        'no-due-date': { label: 'Pending', cls: 'bg-gray-100 text-gray-500' },
    };
    const { label: statusLabel, cls: statusCls } = statusConfig[fineStatus];

    return (
        <div className="space-y-6 animate-fade-in mx-auto max-w-2xl">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 tracking-tight mb-1">My Monthly Bill</h1>
                    <p className="text-gray-500">Billing details for {monthName} {currentYear}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={handlePrevMonth}>
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <div className="font-semibold text-gray-900 min-w-[140px] text-center text-sm">
                        {monthName} {currentYear}
                    </div>
                    <Button variant="outline" size="icon" onClick={handleNextMonth} disabled={isCurrentMonth}>
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            {/* Status banner */}
            {!loadingFine && (
                <FineStatusBanner
                    status={fineStatus}
                    dueDate={fineSettings?.due_date}
                    graceEnd={graceEndStr}
                    fine={fine}
                />
            )}

            <Card className="border-gray-200 shadow-sm overflow-hidden">
                {/* Top summary */}
                <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-6 pt-6 px-6">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">Total Payable</p>
                            <h2 className="text-4xl font-bold text-gray-900">₹{totalPayable.toLocaleString()}</h2>
                        </div>
                        <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold mt-1', statusCls)}>
                            {statusLabel}
                        </span>
                    </div>
                </CardHeader>

                <CardContent className="p-0">
                    {/* Bill Breakdown */}
                    <div className="px-6 pt-5 pb-2">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <Receipt className="w-3.5 h-3.5" /> Bill Breakdown
                        </p>
                    </div>
                    <div className="divide-y divide-gray-100">
                        <div className="grid grid-cols-2 px-6 py-3 hover:bg-gray-50/30 transition-colors">
                            <span className="text-sm text-gray-500 flex items-center gap-2">
                                <Calendar className="w-4 h-4" /> Total Days
                            </span>
                            <span className="text-sm font-medium text-gray-900 text-right">{daysInMonth} days</span>
                        </div>
                        <div className="grid grid-cols-2 px-6 py-3 hover:bg-gray-50/30 transition-colors">
                            <span className="text-sm text-gray-500 flex items-center gap-2">
                                <Minus className="w-4 h-4 text-red-400" /> Leave Days
                            </span>
                            <span className="text-sm font-medium text-red-500 text-right">− {leaveCount} days</span>
                        </div>
                        <div className="grid grid-cols-2 px-6 py-3 hover:bg-gray-50/30 transition-colors bg-blue-50/10">
                            <span className="text-sm text-gray-500 flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-indigo-500" /> Billable Days
                            </span>
                            <span className="text-sm font-semibold text-indigo-700 text-right">{activeDays} days</span>
                        </div>
                        <div className="grid grid-cols-2 px-6 py-3 hover:bg-gray-50/30 transition-colors">
                            <span className="text-sm text-gray-500">Cost per day</span>
                            <span className="text-sm font-medium text-gray-900 text-right">₹{messRate}</span>
                        </div>
                    </div>

                    <Separator />

                    {/* Fine Breakdown */}
                    <div className="px-6 pt-5 pb-2">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <IndianRupee className="w-3.5 h-3.5" /> Payment Summary
                        </p>
                    </div>
                    <div className="divide-y divide-gray-100">
                        <div className="grid grid-cols-2 px-6 py-3 hover:bg-gray-50/30 transition-colors">
                            <span className="text-sm text-gray-500">Mess Fee</span>
                            <span className="text-sm font-medium text-gray-900 text-right">₹{messFee.toLocaleString()}</span>
                        </div>
                        <div className="grid grid-cols-2 px-6 py-3 hover:bg-gray-50/30 transition-colors">
                            <span className={cn('text-sm flex items-center gap-2', fine > 0 ? 'text-red-600' : 'text-gray-400')}>
                                {fine > 0 && <AlertTriangle className="w-3.5 h-3.5" />}
                                Fine
                                {fine === 0 && fineStatus !== 'no-due-date' && (
                                    <span className="text-xs text-gray-400">(none)</span>
                                )}
                            </span>
                            <span className={cn('text-sm font-medium text-right', fine > 0 ? 'text-red-600 font-semibold' : 'text-gray-400')}>
                                {loadingFine ? '...' : fine > 0 ? `₹${fine.toLocaleString()}` : '₹0'}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 px-6 py-4 bg-gray-50/50">
                            <span className="text-sm font-bold text-gray-700">Total Payable</span>
                            <span className="text-base font-bold text-gray-900 text-right">₹{totalPayable.toLocaleString()}</span>
                        </div>
                    </div>

                    {/* Footer note */}
                    <div className="bg-gray-50/30 px-6 py-4 text-center border-t border-gray-100">
                        <p className="text-xs text-gray-400 font-mono">
                            ({daysInMonth} Total − {leaveCount} Leave) × ₹{messRate} = ₹{messFee.toLocaleString()}
                            {fine > 0 && ` + ₹${fine} fine`} = ₹{totalPayable.toLocaleString()}
                        </p>
                        {savings > 0 && (
                            <p className="text-xs text-emerald-600 font-medium mt-1">
                                You saved ₹{savings.toLocaleString()} this month on leaves
                            </p>
                        )}
                        {isPaid && finePayment?.paid_at && (
                            <p className="text-xs text-emerald-600 font-medium mt-1">
                                ✓ Marked as paid on {new Date(finePayment.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
