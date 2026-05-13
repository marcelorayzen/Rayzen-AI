import { parseJUnitXML, parseAllureJSON } from '../qa.service'

// ── parseJUnitXML ─────────────────────────────────────────
describe('parseJUnitXML', () => {
  it('parses minimal JUnit XML', () => {
    const xml = `<?xml version="1.0"?>
<testsuites tests="3" failures="1" errors="0" skipped="0" time="1.5">
  <testsuite name="SuiteA" tests="3" failures="1" time="1.5">
    <testcase classname="com.example.Test" name="passes" time="0.5"/>
    <testcase classname="com.example.Test" name="also_passes" time="0.5"/>
    <testcase classname="com.example.Test" name="fails" time="0.5">
      <failure message="Expected true but was false">stack trace here</failure>
    </testcase>
  </testsuite>
</testsuites>`

    const result = parseJUnitXML(xml)

    expect(result.tool).toBe('junit')
    expect(result.totalTests).toBe(3)
    expect(result.failed).toBe(1)
    expect(result.passed).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.failedCases).toHaveLength(1)
    expect(result.failedCases[0].name).toBe('fails')
    expect(result.failedCases[0].message).toBe('Expected true but was false')
  })

  it('handles CDATA in failure message', () => {
    const xml = `<testsuites tests="1" failures="1">
  <testsuite name="Suite" tests="1" failures="1">
    <testcase classname="Cls" name="test">
      <failure message="raw"><![CDATA[Detailed failure
with newlines & special <chars>]]></failure>
    </testcase>
  </testsuite>
</testsuites>`

    const result = parseJUnitXML(xml)
    expect(result.failedCases[0].stacktrace).toContain('Detailed failure')
    expect(result.failedCases[0].stacktrace).toContain('special <chars>')
  })

  it('decodes XML entities in attributes', () => {
    const xml = `<testsuites tests="1" failures="1">
  <testsuite name="Suite" tests="1" failures="1">
    <testcase classname="com.example" name="test&amp;more">
      <failure message="value &lt; 0"/>
    </testcase>
  </testsuite>
</testsuites>`

    const result = parseJUnitXML(xml)
    expect(result.failedCases[0].name).toBe('test&more')
    expect(result.failedCases[0].message).toBe('value < 0')
  })

  it('handles single-quoted attributes', () => {
    const xml = `<testsuites tests='1' failures='1'>
  <testsuite name='S' tests='1' failures='1'>
    <testcase classname='Cls' name='t1'>
      <failure message='oops'>stack</failure>
    </testcase>
  </testsuite>
</testsuites>`

    const result = parseJUnitXML(xml)
    expect(result.totalTests).toBe(1)
    expect(result.failedCases[0].message).toBe('oops')
  })

  it('returns zeros when XML has no tests', () => {
    const result = parseJUnitXML('<testsuites/>')
    expect(result.totalTests).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.passed).toBe(0)
    expect(result.failedCases).toHaveLength(0)
  })

  it('does not include passing testcases in failedCases', () => {
    const xml = `<testsuites tests="2" failures="0">
  <testsuite name="S" tests="2" failures="0">
    <testcase classname="C" name="p1" time="0.1"/>
    <testcase classname="C" name="p2" time="0.2"/>
  </testsuite>
</testsuites>`

    const result = parseJUnitXML(xml)
    expect(result.failedCases).toHaveLength(0)
    expect(result.passed).toBe(2)
  })

  it('falls back to sum of suites when no root testsuites tag', () => {
    const xml = `<testsuite name="S" tests="5" failures="2" time="3.0">
  <testcase classname="C" name="f1"><failure message="err1"/></testcase>
  <testcase classname="C" name="f2"><failure message="err2"/></testcase>
</testsuite>`

    const result = parseJUnitXML(xml)
    expect(result.totalTests).toBe(5)
    expect(result.failed).toBe(2)
    expect(result.failedCases).toHaveLength(2)
  })

  it('passed is never negative', () => {
    // some tools report skipped inside failures count which can make raw math negative
    const xml = `<testsuites tests="1" failures="2" skipped="0">
  <testsuite name="S" tests="1" failures="2"/>
</testsuites>`
    const result = parseJUnitXML(xml)
    expect(result.passed).toBeGreaterThanOrEqual(0)
  })
})

// ── parseAllureJSON ───────────────────────────────────────
describe('parseAllureJSON', () => {
  it('parses allure results array', () => {
    const raw = JSON.stringify([
      { name: 'test1', status: 'passed', duration: 100 },
      { name: 'test2', status: 'failed', duration: 200, statusDetails: { message: 'AssertionError', trace: 'at line 42' }, labels: [{ name: 'suite', value: 'SuiteA' }] },
      { name: 'test3', status: 'skipped', duration: 0 },
    ])

    const result = parseAllureJSON(raw)

    expect(result.tool).toBe('allure')
    expect(result.totalTests).toBe(3)
    expect(result.passed).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.failedCases).toHaveLength(1)
    expect(result.failedCases[0].suite).toBe('SuiteA')
    expect(result.failedCases[0].name).toBe('test2')
    expect(result.failedCases[0].message).toBe('AssertionError')
  })

  it('handles empty allure array', () => {
    const result = parseAllureJSON('[]')
    expect(result.totalTests).toBe(0)
    expect(result.failedCases).toHaveLength(0)
  })

  it('handles broken status as failed', () => {
    const raw = JSON.stringify([{ name: 'x', status: 'broken' }])
    const result = parseAllureJSON(raw)
    expect(result.failed).toBe(1)
    expect(result.failedCases[0].message).toBe('broken')
  })
})
