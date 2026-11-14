import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge, DeployStatusPill, StatusPill } from './Badge';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Field, Input } from './Input';
import { LogViewer } from './LogViewer';
import { Meter } from './Meter';
import { Select } from './Select';
import { Tabs } from './Tabs';
import { Table, TBody, TD, TH, THead, TR } from './Table';
import { Toggle } from './Toggle';

/**
 * Light render tests (no DOM): we render primitives to static markup and assert
 * the accessibility contract — roles, ARIA state, labels and tone. Interaction
 * (keyboard, focus trap) is covered by manual/e2e verification; see
 * docs/design/DECISIONS.md.
 */

describe('Button', () => {
  it('shows the reason as a title and is aria-disabled when disabled', () => {
    const html = renderToStaticMarkup(
      <Button disabled reason="Requires the operator role">
        Restart
      </Button>,
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('title="Requires the operator role"');
    expect(html).toContain('Restart');
  });
});

describe('Badge / status pills', () => {
  it('renders the service state with an ok tone for running', () => {
    const html = renderToStaticMarkup(<StatusPill state="running" />);
    expect(html).toContain('running');
    expect(html).toContain('text-ok');
  });
  it('maps a failed deploy to the danger tone and a friendly label', () => {
    const html = renderToStaticMarkup(<DeployStatusPill status="failure" />);
    expect(html).toContain('Failed');
    expect(html).toContain('text-danger');
  });
  it('supports a neutral default tone', () => {
    expect(renderToStaticMarkup(<Badge>idle</Badge>)).toContain('text-muted');
  });
});

describe('Meter', () => {
  it('exposes role=meter with a percentage value', () => {
    const html = renderToStaticMarkup(<Meter value={42} label="CPU" display="42%" />);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-label="CPU"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('42%');
  });
  it('omits aria-valuenow when the value is unknown', () => {
    const html = renderToStaticMarkup(<Meter value={NaN} label="CPU" display="—" />);
    expect(html).not.toContain('aria-valuenow');
  });
});

describe('Toggle', () => {
  it('is a labelled switch reflecting its checked state', () => {
    const html = renderToStaticMarkup(
      <Toggle checked label="Enable actions" onChange={() => {}} />,
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Enable actions"');
  });
});

describe('Field + Input', () => {
  it('wires the label and error to the input for assistive tech', () => {
    const html = renderToStaticMarkup(
      <Field label="Token" error="Required">
        {({ id, describedBy, invalid }) => (
          <Input id={id} aria-describedby={describedBy} invalid={invalid} />
        )}
      </Field>,
    );
    expect(html).toContain('Token');
    expect(html).toContain('Required');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/aria-describedby="[^"]+"/);
  });
});

describe('Select', () => {
  it('renders its options', () => {
    const html = renderToStaticMarkup(
      <Select
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
      />,
    );
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
  });
});

describe('Tabs', () => {
  it('marks the active tab selected and roving-tabindex the rest', () => {
    const html = renderToStaticMarkup(
      <Tabs
        label="Sections"
        active="logs"
        onChange={() => {}}
        tabs={[
          { id: 'logs', label: 'Logs' },
          { id: 'env', label: 'Env' },
        ]}
      />,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('tabindex="-1"');
  });
});

describe('Table', () => {
  it('renders a labelled table with header and body', () => {
    const html = renderToStaticMarkup(
      <Table label="Services">
        <THead>
          <TH>Name</TH>
        </THead>
        <TBody>
          <TR>
            <TD>web</TD>
          </TR>
        </TBody>
      </Table>,
    );
    expect(html).toContain('aria-label="Services"');
    expect(html).toContain('web');
  });
});

describe('EmptyState', () => {
  it('shows a title and description', () => {
    const html = renderToStaticMarkup(
      <EmptyState title="No env collected" description="Set variables to see them here." />,
    );
    expect(html).toContain('No env collected');
    expect(html).toContain('Set variables');
  });
});

describe('LogViewer', () => {
  it('tints stderr lines and renders timestamps', () => {
    const html = renderToStaticMarkup(
      <LogViewer rows={[{ ts: 0, stream: 'stderr', line: 'boom' }]} />,
    );
    expect(html).toContain('role="log"');
    expect(html).toContain('text-errfg');
    expect(html).toContain('boom');
  });
  it('shows an empty state when there are no rows', () => {
    const html = renderToStaticMarkup(<LogViewer rows={[]} empty={{ title: 'No logs yet' }} />);
    expect(html).toContain('No logs yet');
  });
});
