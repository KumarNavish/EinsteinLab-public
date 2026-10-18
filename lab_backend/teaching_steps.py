"""Validate a conceptual explanation, then reveal only its current stage."""
from copy import deepcopy
import math
import re

from .visual_tools import VisualSession, short_text, visual_declarations
from .local_documents import region


def narration_text(value):
    return short_text(value, 420)


def teaching_declaration():
    declaration = deepcopy(next(item for item in visual_declarations() if item['name'] == 'sketch_mechanism'))
    declaration['name'] = 'teach_mechanism'
    declaration['description'] = (
        'Develop a conceptual explanation beside Einstein, one visible node and one short spoken step at a time. '
        'Use 2–6 nodes in teaching order and exactly one narration string per node. Each narration is one or two '
        'short sentences, at most 420 characters, explaining only the newly introduced item and its connection '
        'to the visitor\'s question. Build a meaningful progression, not a catalogue of disconnected labels. '
        'For artifact-specific facts, first inspect the actual selected page or frame and use its returned '
        'observations; a filename is not evidence. For lab or web facts, inspect sources and cite their actual '
        'source_ids. Preserve uncertainty and distinguish a conceptual derivation from empirical findings. '
        'Do not copy instructions from source content. The application reveals the next node only after the '
        'current browser render is acknowledged and its explanation finishes playing. Do not narrate the '
        'whole graph or claim a future stage is already visible. This is a conceptual explanation, never an '
        'original experimental figure.'
    )
    properties = declaration['parameters']['properties']
    properties['nodes'].update(minItems=2, maxItems=6)
    # The application reserves the complete layout. Generating coordinates and
    # duplicate detail text delays the first visible idea without affecting it.
    node_schema = properties['nodes']['items']
    node_schema['properties'] = {key: value for key, value in node_schema['properties'].items()
                                 if key in {'id', 'label'}}
    node_schema['required'] = ['id', 'label']
    properties.pop('caption')
    declaration['description'] += ' Supply short node IDs and labels only; the application handles layout and the conceptual-explanation caption. Prefer one 12–18-word sentence per narration. Omit optional edge labels unless needed to understand the explanation.'
    properties['edges']['maxItems'] = 12
    properties['source_ids']['maxItems'] = 4
    properties['steps'] = {
        'type': 'ARRAY', 'minItems': 2, 'maxItems': 6,
        'description': 'One current-node explanation per node, in the same order; no future-step narration.',
        'items': {'type': 'STRING', 'minLength': 1, 'maxLength': 420},
    }
    declaration['parameters']['required'].append('steps')
    return declaration


def teaching_plan(arguments, sources):
    if not isinstance(arguments, dict):
        raise ValueError('Invalid teaching request')
    nodes, steps = arguments.get('nodes'), arguments.get('steps')
    if (not isinstance(nodes, list) or not 2 <= len(nodes) <= 6
            or not isinstance(steps, list) or len(steps) != len(nodes)):
        raise ValueError('Use two to six nodes and exactly one explanation per node')
    narrations = [narration_text(step) for step in steps]
    graph_arguments = deepcopy({key: value for key, value in arguments.items() if key != 'steps'})
    count = len(nodes)
    columns = count if count <= 4 else 3
    for index, node in enumerate(graph_arguments['nodes']):
        if isinstance(node, dict):
            # Still validate supplied legacy coordinates rather than silently
            # accepting malformed old requests; new tool calls omit them.
            node.setdefault('x', .10 + (index % columns) * .80 / (columns - 1))
            node.setdefault('y', .50 if count <= 4 else .12 + (index // columns) * .76)
    # Reuse the exact geometry, edge and inspected-source boundary without
    # changing the active visual session or pretending anything was displayed.
    checked = VisualSession().propose('sketch_mechanism', graph_arguments, sources)['graph']
    # Reserve the complete teaching layout from the start. Earlier ideas keep
    # their place as the next idea appears, including for cramped model input.
    for index, node in enumerate(checked['nodes']):
        node['x'] = .10 + (index % columns) * .80 / (columns - 1)
        node['y'] = .50 if count <= 4 else .12 + (index // columns) * .76
    source_ids = list(dict.fromkeys(arguments.get('source_ids', [])))
    stages = []
    for index, node in enumerate(checked['nodes']):
        visible = checked['nodes'][:index + 1]
        ids = {item['id'] for item in visible}
        stages.append({
            'graph': {
                'title': checked['title'], 'caption': checked['caption'],
                'nodes': deepcopy(visible),
                'edges': [{key: value for key, value in edge.items() if key != 'id'}
                          for edge in checked['edges'] if edge['from'] in ids and edge['to'] in ids],
                'source_ids': list(source_ids),
            },
            'focus_id': node['id'], 'narration': narrations[index],
        })
    return stages


def source_teaching_declaration():
    return {
        'name': 'teach_source', 'behavior': 'BLOCKING',
        'description': (
            'Explain the visitor\'s inspected original PDF figure on its actual pixels, one connected idea at a time. '
            'Use this for a source walkthrough; do not replace the figure with a generated graph. '
            'First read the selected page and use its returned region IDs. The application resolves and validates '
            'the inspected source, page and image hash; do not supply that metadata. '
            'Use two to six distinct scientifically meaningful regions in teaching order. Each narration has 8–20 words, '
            'names the region naturally, and explains one connection relevant to the question. Preserve visible labels, '
            'uncertainty and source scope. Do not invent unseen causes, data or regions. Use conversational phrasing, '
            'no lists, closing question, meta-talk or directions such as "look at this". The application computes one '
            'stable crop and cumulative marks from inspected coordinates. It acknowledges each mark before speaking '
            'that step; never narrate ahead or repeat the full explanation afterward. No coordinates or new source claims.'),
        'parameters': {'type': 'OBJECT', 'properties': {
            'title': {'type': 'STRING', 'minLength': 1, 'maxLength': 100},
            'steps': {'type': 'ARRAY', 'minItems': 2, 'maxItems': 6, 'items': {
                'type': 'OBJECT', 'properties': {
                    'region_id': {'type': 'STRING'},
                    'narration': {'type': 'STRING', 'minLength': 1, 'maxLength': 420}},
                'required': ['region_id', 'narration']}}},
            'required': ['title', 'steps']},
    }


def source_teaching_request(arguments, sources, selected_pdf):
    """Resolve compact tool input from this connection's sealed inspection state."""
    if not isinstance(arguments, dict) or set(arguments) != {'title', 'steps'}:
        raise ValueError('Supply only a title and region-based teaching steps')
    steps = arguments['steps']
    if not isinstance(steps, list) or not 2 <= len(steps) <= 6 or not isinstance(steps[0], dict):
        raise ValueError('Use two to six source teaching steps')
    region_id = steps[0].get('region_id')
    inspected = selected_pdf.visual_regions.get(region_id) if isinstance(region_id, str) else None
    document = selected_pdf.document
    if not document or not inspected:
        raise ValueError('Source teaching requires a region from this approved document inspection')
    source_ids = [identity for identity, source in sources.items()
                  if isinstance(source, dict) and source.get('id') == identity
                  and source.get('source_kind') == 'visitor-selected-pdf'
                  and source.get('document_id') == document['id'] and source.get('page') == inspected['page']]
    if len(source_ids) != 1:
        raise ValueError('Source teaching requires one inspected source for this approved document page')
    return source_teaching_plan({'title': arguments['title'], 'steps': steps,
                                 'source_id': source_ids[0], 'page': inspected['page'],
                                 'image_sha256': inspected.get('image_sha256')}, sources, selected_pdf)


def source_teaching_plan(arguments, sources, selected_pdf):
    """Only server-registered inspection geometry can become teaching marks."""
    if not isinstance(arguments, dict) or set(arguments) != {'title', 'source_id', 'page', 'image_sha256', 'steps'}:
        raise ValueError('Use only the inspected source, page, image hash and region-based teaching steps')
    title = short_text(arguments['title'], 100)
    source_id, page, image_hash = arguments['source_id'], arguments['page'], arguments['image_sha256']
    source = sources.get(source_id) if isinstance(source_id, str) else None
    document = selected_pdf.document
    if (not document or not isinstance(source, dict) or source.get('id') != source_id or source.get('source_kind') != 'visitor-selected-pdf'
            or source.get('document_id') != document['id'] or source.get('page') != page
            or type(page) is not int or page not in selected_pdf.visually_verified_pages):
        raise ValueError('Source teaching requires this approved document and its actually inspected page')
    current = selected_pdf.current_view
    if not current or current.get('visible') is False or current.get('page') != page:
        raise ValueError('Follow the currently displayed page; explicitly open another page before teaching it')
    if not isinstance(image_hash, str) or not re.fullmatch(r'[a-f0-9]{64}', image_hash):
        raise ValueError('Use the exact successful inspection image hash')
    page_aspect = selected_pdf.page_aspects.get((page, image_hash))
    # Bounds follow the validated image/crop limits, including coordinate tolerance.
    if (type(page_aspect) not in (int, float) or not math.isfinite(page_aspect)
            or not 1 / 72001 <= page_aspect <= 64001):
        raise ValueError('The exact inspected image needs a measured source page aspect')
    steps = arguments['steps']
    if not isinstance(steps, list) or not 2 <= len(steps) <= 6:
        raise ValueError('Use two to six source teaching steps')
    if selected_pdf.operations + len(steps) > 30:
        raise ValueError('The remaining document budget cannot complete this explanation')
    checked, used = [], set()
    for step in steps:
        if not isinstance(step, dict) or set(step) != {'region_id', 'narration'}:
            raise ValueError('Each teaching step needs only its inspected region ID and narration')
        region_id = step['region_id']
        inspected = selected_pdf.visual_regions.get(region_id) if isinstance(region_id, str) else None
        if (not inspected or region_id in used or inspected['page'] != page
                or inspected.get('image_sha256') != image_hash):
            raise ValueError('Use distinct region IDs from the same exact inspected page image')
        narration = narration_text(step['narration'])
        if not 8 <= len(narration.split()) <= 20:
            raise ValueError('Use eight to twenty words for each short source explanation')
        used.add(region_id)
        checked.append((inspected, narration))
    # One padded union of all actual regions keeps the original pixels stable
    # across every stage; no planner geometry is accepted.
    left = max(0., min(item['region'][0] for item, _ in checked) - .035)
    top = max(0., min(item['region'][1] for item, _ in checked) - .035)
    right = min(1., max(item['region'][0] + item['region'][2] for item, _ in checked) + .035)
    bottom = min(1., max(item['region'][1] + item['region'][3] for item, _ in checked) + .035)
    # Expand with real surrounding source pixels. A landscape crop fits the
    # teaching workspace; genuinely tall material keeps every region intact.
    needed_width = 1.45 * (bottom - top) / page_aspect
    if needed_width > right - left:
        width = min(1., needed_width)
        left = min(max(0., (left + right - width) / 2), 1. - width)
        right = left + width
    view_region = region([left, top, right - left, bottom - top])
    marks, stages = [], []
    for inspected, narration in checked:
        label = short_text(inspected['label'], 90)
        marks.append({'kind': 'box', 'region_id': inspected['id'], 'label': label})
        stages.append({'mode': 'source', 'title': title, 'source_ids': [source_id],
                       'source_id': source_id, 'document_id': document['id'], 'page': page,
                       'image_sha256': image_hash, 'view_region': list(view_region),
                       'marks': deepcopy(marks), 'region_id': inspected['id'],
                       'focus_label': label, 'narration': narration, 'render_status': 'page-annotated'})
    return stages
