// 界面入口。改了 src/ 之后 iimos reload:先编译到 dist/,成功了才重载窗口。
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './style.css';

createRoot(document.getElementById('root')!).render(<App />);
