/**
 * Placeholder page for the landing page editor.
 * This is where the user lands after clicking "Create Landing Page".
 */
import { useParams } from "react-router-dom";

export function LandingPageEditorPage() {
  const { pageId } = useParams<{ pageId: string }>();

  return (
    <div className="page-editor">
      <header className="page-editor__header">
        <h1>Landing Page Editor</h1>
        <p className="page-editor__id">Page ID: {pageId}</p>
      </header>
      <div className="page-editor__placeholder">
        <p>
          The landing page editor will be available here. You can edit the
          content, add callout boxes, configure sharing settings, and publish.
        </p>
      </div>
    </div>
  );
}
