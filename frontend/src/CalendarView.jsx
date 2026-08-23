import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';

export default function CalendarView({ notes, selectedDate, onSelectDate }) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();

  // Create a map of YYYY-MM-DD -> array of notes
  const notesByDate = useMemo(() => {
    const map = {};
    notes.forEach(note => {
      if (!note.dateProcessed) return;
      // Convert to local YYYY-MM-DD
      const dateObj = new Date(note.dateProcessed);
      // Format as YYYY-MM-DD carefully considering local timezone
      const dateString = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
      if (!map[dateString]) map[dateString] = [];
      map[dateString].push(note);
    });
    return map;
  }, [notes]);

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay(); // 0 is Sunday

  const prevMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
  };

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const renderDays = () => {
    const blanks = [];
    for (let i = 0; i < firstDayOfMonth; i++) {
      blanks.push(<div key={`blank-${i}`} className="calendar-day empty"></div>);
    }

    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateString = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayNotes = notesByDate[dateString] || [];
      const hasNotes = dayNotes.length > 0;
      const isSelected = selectedDate === dateString;

      days.push(
        <div 
          key={d} 
          className={`calendar-day ${hasNotes ? 'has-notes' : ''} ${isSelected ? 'selected' : ''}`}
          onClick={() => {
            if (isSelected) {
              onSelectDate(null); // Deselect if already selected
            } else {
              onSelectDate(dateString);
            }
          }}
          style={{
            padding: '10px',
            minHeight: '60px',
            border: '1px solid rgba(255,255,255,0.05)',
            position: 'relative',
            cursor: 'pointer',
            backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
            borderRadius: '4px',
            transition: 'all 0.2s'
          }}
        >
          <span style={{ 
            fontWeight: isSelected || hasNotes ? 700 : 400,
            color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)'
          }}>
            {d}
          </span>
          {hasNotes && (
            <div style={{
              marginTop: '4px',
              width: '8px',
              height: '8px',
              backgroundColor: 'var(--accent-primary)',
              borderRadius: '50%',
              margin: '6px auto 0'
            }} />
          )}
          {hasNotes && dayNotes.length > 1 && (
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '2px' }}>
              {dayNotes.length} saved
            </div>
          )}
        </div>
      );
    }

    return [...blanks, ...days];
  };

  return (
    <div style={{ padding: '16px', backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: '12px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>
          <ChevronLeft size={24} />
        </button>
        <h3 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CalendarIcon size={18} />
          {monthNames[currentMonth]} {currentYear}
        </h3>
        <button onClick={nextMonth} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>
          <ChevronRight size={24} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', marginBottom: '8px' }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>{day}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
        {renderDays()}
      </div>
    </div>
  );
}
