import { List, Sun, Moon, Desktop, X, Check } from '@phosphor-icons/react';
import type { Tab } from '../types';

interface TabBarProps {
  tabs: Tab[];
  currentTab: string | null;
  serverConnected: boolean;
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
    <div className="flex items-center bg-app-secondary border-b border-default px-2 h-10 gap-0.5 overflow-x-auto scrollbar-none">
      <button
        className="flex items-center justify-center w-8 h-8 rounded text-muted cursor-pointer mr-2 bg-card-hover transition-colors hover:text-primary"
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
              ? 'bg-selected text-primary'
              : 'text-muted bg-card-hover hover:text-primary'
          }`}
          onClick={() => onTabClick(tab.name)}
        >
          <span className="overflow-hidden text-ellipsis">{tab.displayName}</span>
          {tab.completed && <Check size={14} className="text-emerald-500" />}
          <span
            className="opacity-0 w-4 h-4 flex items-center justify-center rounded text-sm leading-none group-hover:opacity-50 hover:!opacity-100 hover:bg-card-hover"
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
          className="flex items-center justify-center w-7 h-7 rounded text-muted cursor-pointer bg-card-hover transition-colors hover:text-primary"
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
        <button
          className="h-7 px-2.5 text-[11px] font-medium rounded bg-emerald-500/20 text-emerald-400 cursor-pointer hover:bg-emerald-500/30 transition-colors"
          onClick={onComplete}
          title="Complete review and export"
        >
          Complete
        </button>
      </div>
    </div>
  );
}
