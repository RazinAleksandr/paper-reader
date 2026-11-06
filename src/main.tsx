import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useParams } from 'react-router-dom';
import '@fontsource-variable/source-serif-4/opsz.css';
import '@fontsource-variable/source-serif-4/opsz-italic.css';
import 'katex/dist/katex.min.css';
import './styles.css';
import { Library } from './pages/Library.tsx';
import { Reader } from './pages/Reader.tsx';
import { QuickSwitcher } from './components/QuickSwitcher.tsx';

/** Remount the reader per paper so no state leaks from one paper into another. */
function ReaderRoute({ onSwitcher }: { onSwitcher(): void }) {
  const { id = '' } = useParams();
  return <Reader key={id} onSwitcher={onSwitcher} />;
}

function App() {
  const [switcher, setSwitcher] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'л' || e.key === 'p' || e.key === 'з')) {
        e.preventDefault();
        setSwitcher((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <Routes>
        <Route path="/" element={<Library onSwitcher={() => setSwitcher(true)} />} />
        <Route path="/paper/:id" element={<ReaderRoute onSwitcher={() => setSwitcher(true)} />} />
      </Routes>
      {switcher && <QuickSwitcher onClose={() => setSwitcher(false)} />}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
