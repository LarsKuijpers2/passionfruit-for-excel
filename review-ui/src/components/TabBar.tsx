import { List, Sun, Moon, Desktop, Plus, X, Check } from '@phosphor-icons/react';
import type { Tab, QuestionnaireListItem } from '../types';

interface TabBarProps {
  tabs: Tab[];
  currentTab: string | null;
  questionnaires: QuestionnaireListItem[];
  serverConnected: boolean;
  reviewMode: boolean;
  feedbackCount: number;
  theme: 'light' | 'dark' | 'system';
  onSidebarToggle: () => void;
  onTabClick: (name: string) => void;
  onTabClose: (index: number) => void;
  onAddTab: (name: string) => void;
  onReviewToggle: () => void;
  onComplete: () => void;
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
}

export function TabBar({
  tabs,
  currentTab,
  serverConnected,
  reviewMode,
  feedbackCount,
  theme,
  onSidebarToggle,
  onTabClick,
  onTabClose,
  onReviewToggle,
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
    <div className="flex items-center bg-[#1a1a1c] border-b border-border px-2 h-10 gap-0.5 overflow-x-auto scrollbar-none">
      <button
        className="flex items-center justify-center w-8 h-8 bg-transparent border-none rounded text-muted-foreground cursor-pointer mr-2 hover:bg-white/[0.08] hover:text-foreground"
        onClick={onSidebarToggle}
        title="Open questionnaire list (B)"
      >
        <List size={18} />
      </button>

      {tabs.map((tab, index) => (
        <button
          key={tab.name}
          className={`flex items-center gap-2 px-3 py-1.5 bg-transparent border-none rounded-t-md text-muted-foreground text-xs font-medium cursor-pointer whitespace-nowrap max-w-[200px] transition-all duration-150 hover:bg-white/5 hover:text-foreground group ${
            tab.name === currentTab ? 'bg-background text-foreground' : ''
          }`}
          onClick={() => onTabClick(tab.name)}
        >
          <span className="overflow-hidden text-ellipsis">{tab.displayName}</span>
          {tab.completed && <Check size={14} className="text-green-500 ml-1" />}
          <span
            className="opacity-0 w-4 h-4 flex items-center justify-center rounded text-sm leading-none group-hover:opacity-50 hover:!opacity-100 hover:bg-white/10"
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

      <button
        className="flex items-center justify-center w-7 h-7 bg-transparent border-none rounded text-muted-foreground cursor-pointer ml-1 hover:bg-white/[0.08] hover:text-foreground"
        title="Open questionnaire (+)"
      >
        <Plus size={16} />
      </button>

      <div className="flex items-center gap-2 ml-auto pr-2">
        <button
          className="flex items-center justify-center w-7 h-7 bg-transparent border-none rounded text-muted-foreground cursor-pointer hover:bg-white/[0.08] hover:text-foreground"
          onClick={cycleTheme}
          title={`Theme: ${theme} (click to cycle)`}
        >
          {theme === 'light' && <Sun size={16} />}
          {theme === 'dark' && <Moon size={16} />}
          {theme === 'system' && <Desktop size={16} />}
        </button>
        <span
          className={`w-2 h-2 rounded-full mr-2 ${
            serverConnected ? 'bg-green-500' : 'bg-red-500'
          }`}
          title={serverConnected ? 'Connected to server' : 'Server disconnected'}
        />
        <button
          className={`px-2.5 py-1 text-[11px] font-medium rounded border cursor-pointer transition-all duration-150 ${
            reviewMode
              ? 'bg-foreground text-background border-foreground'
              : 'bg-secondary text-muted-foreground border-border hover:bg-accent hover:text-foreground'
          }`}
          onClick={onReviewToggle}
          title="Toggle review mode (R)"
        >
          Review
        </button>
        <button
          className="px-2.5 py-1 text-[11px] font-medium rounded border border-border bg-secondary text-muted-foreground cursor-pointer transition-all duration-150 hover:bg-accent hover:text-foreground"
          onClick={onComplete}
          title="Complete Review"
        >
          Complete ({feedbackCount})
        </button>
      </div>
    </div>
  );
}
