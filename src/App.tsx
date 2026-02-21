import React from 'react';
import { SessionProvider, useSession } from './contexts/SessionContext';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { Part1Rubric } from './components/Part1Rubric';
import { Part2WordToCsv } from './components/Part2WordToCsv';
import { Part3Upload } from './components/Part3Upload';
import { ScreenshotConverter } from './components/ScreenshotConverter';
import HelpCenter from './components/HelpCenter';
import { AppMode } from './types';

const AppContent: React.FC = () => {
  const { state, setHelpOpen } = useSession();

  const renderContent = () => {
    switch (state.currentStep) {
      case AppMode.DASHBOARD:
        return <Dashboard />;
      case AppMode.PART_1:
        return <Part1Rubric />;
      case AppMode.PART_2:
        return <Part2WordToCsv />;
      case AppMode.PART_3:
        return <Part3Upload />;
      case AppMode.SCREENSHOT:
        return <ScreenshotConverter />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <Layout>
      {renderContent()}
      <HelpCenter isOpen={state.helpOpen} onClose={() => setHelpOpen(false)} />
    </Layout>
  );
};

const App: React.FC = () => {
  return (
    <SessionProvider>
      <AppContent />
    </SessionProvider>
  );
};

export default App;
