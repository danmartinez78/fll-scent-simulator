import type { NotebookEntry } from '../notebook/notebook';
import { notebookCsv, notebookReportHtml, reportFileStem } from '../notebook/report';
import { downloadText, openHtml } from './ui';

/** Report and spreadsheet exports of the whole notebook. */
export function ReportButtons({ entries }: { entries: NotebookEntry[] }) {
  const none = !entries.length;
  return (
    <>
      <button
        className="btn small"
        disabled={none}
        title="Open a printable report of every experiment"
        onClick={() => openHtml(`${reportFileStem()}.html`, notebookReportHtml(entries))}
      >
        📄 Report
      </button>
      <button
        className="btn small"
        disabled={none}
        title="Download every experiment as a spreadsheet (CSV)"
        onClick={() => downloadText(`${reportFileStem()}.csv`, notebookCsv(entries), 'text/csv')}
      >
        📊 Spreadsheet
      </button>
    </>
  );
}
