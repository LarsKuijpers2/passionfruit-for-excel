import { List, Sun, Moon, Desktop, X, Check } from '@phosphor-icons/react';
import type { Tab } from '../types';

interface TabBarProps {
  tabs: Tab[];
  currentTab: string | null;
  serverConnected: boolean;
  feedbackCount: number;
  theme: 'light' | 'dark' | 'system';
  onSidebarToggle: () => void;
  onTabClick: (name: string) => void;
  onTabClose: (index: number) => void;
  onComplete: () => void;
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
}

export function TabBar({
  tabs,
  currentTab,
  serverConnected,
  feedbackCount,
  theme,
  onSidebarToggle,
  onTabClick,
  onTabClose,
  onComplete,
  onThemeChange,
}: TabBarProps) {
  const cycleTheme = () => {
    const themes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    onThemeChange(themes[nextIndex]);
  };

  return (
    <div className="flex items-center bg-neutral-900 border-b border-neutral-800 px-2 h-10 gap-0.5 overflow-x-auto scrollbar-none">
      <button
        className="flex items-center justify-center w-8 h-8 rounded text-neutral-500 cursor-pointer mr-2 hover:bg-neutral-800 hover:text-neutral-300 transition-colors"
        onClick={onSidebarToggle}
        title="Open questionnaire list (B)"
      >
        <List size={18} />
      </button>

      {tabs.map((tab, index) => (
        <button
          key={tab.name}
          className={`flex items-center gap-2 h-8 px-3 rounded text-[12px] font-medium cursor-pointer whitespace-nowrap max-w-[200px] transition-colors group ${
            tab.name === currentTab
              ? 'bg-neutral-800 text-neutral-100'
              : 'text-neutral-500 hover:bg-neutral-800/50 hover:text-neutral-300'
          }`}
          onClick={() => onTabClick(tab.name)}
        >
          <span className="overflow-hidden text-ellipsis">{tab.displayName}</span>
          {tab.completed && <Check size={14} className="text-emerald-500" />}
          <span
            className="opacity-0 w-4 h-4 flex items-center justify-center rounded text-sm leading-none group-hover:opacity-50 hover:!opacity-100 hover:bg-neutral-700"
            title="Close tab"
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(index);
            }}
          >
            <X size={12} />
          </span>
        </button>
      ))}

      <div className="flex items-center gap-2 ml-auto pr-2">
        <button
          className="flex items-center justify-center w-7 h-7 rounded text-neutral-500 cursor-pointer hover:bg-neutral-800 hover:text-neutral-300 transition-colors"
          onClick={cycleTheme}
          title={`Theme: ${theme} (click to cycle)`}
        >
          {theme === 'light' && <Sun size={16} />}
          {theme === 'dark' && <Moon size={16} />}
          {theme === 'system' && <Desktop size={16} />}
        </button>
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            serverConnected ? 'bg-emerald-500' : 'bg-red-500'
          }`}
          title={serverConnected ? 'Connected to server' : 'Server disconnected'}
        />
        {feedbackCount > 0 && (
          <button
            className="h-7 px-2.5 text-[11px] font-medium rounded bg-emerald-500/20 text-emerald-400 cursor-pointer hover:bg-emerald-500/30 transition-colors"
            onClick={onComplete}
            title="Complete Review"
          >
            Complete ({feedbackCount})
          </button>
        )}
      </div>
    </div>
  );
}
