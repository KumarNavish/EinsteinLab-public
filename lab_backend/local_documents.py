"""Connection-local contract for a visitor-selected PDF kept in browser memory.

No file upload endpoint, URL fetch, path access, OCR, shell, conversion service,
or document storage is implemented here. The visitor explicitly approves page
sharing; every model operation must be acknowledged by that same live browser.
"""
from __future__ import annotations
import base64
import hashlib
import io
import math
import re
import secrets
from PIL import Image

DOCUMENT_TOOLS = frozenset({'read_selected_pdf_page', 'mark_selected_pdf', 'close_selected_pdf_view'})

# Only finite local validator classifications leave the connection. Submitted
# strings, unknown field names and exception text never become diagnostics.
VALIDATION_CODES = {
    'No visitor-selected PDF is approved in this conversation': 'document-not-approved',
    'Wait for the preceding PDF action to finish': 'document-action-pending',
    'The thirty-operation document budget is exhausted': 'document-action-budget',
    'Invalid PDF action arguments': 'arguments-not-object',
    'Unexpected reading fields': 'unexpected-reading-fields',
    'That page does not exist': 'page-out-of-range',
    'A region needs four finite coordinates': 'region-not-four-finite-coordinates',
    'Region falls outside the source page': 'region-out-of-bounds',
    'Unexpected annotation fields': 'unexpected-annotation-fields',
    'A successful source-pixel inspection is required before placing an annotation; do not guess from extracted text': 'page-not-visually-inspected',
    'Use one to six source-anchored annotations': 'annotation-count-invalid',
    'Unsupported annotation type': 'annotation-kind-invalid',
    'Use a short annotation label': 'annotation-label-invalid',
    'Invalid source region identifier': 'region-id-invalid',
    'Select a returned visual region ID from this exact inspected page': 'region-id-not-on-page',
    'Use a source region ID or explicit coordinates, not both': 'region-id-and-coordinates',
    'Replace must be a boolean': 'replace-not-boolean',
    'Closing the view takes no arguments': 'unexpected-close-fields',
    'Unknown PDF operation': 'unknown-document-tool',
}


def value_kind(value):
    if value is None: return 'null'
    if type(value) is bool: return 'boolean'
    if type(value) is int: return 'integer'
    if type(value) is float: return 'number'
    if isinstance(value, str): return 'string'
    if isinstance(value, list): return 'array'
    if isinstance(value, dict): return 'object'
    return 'other'


def region(value, minimum=.025):
    if not isinstance(value, list) or len(value) != 4 or any(type(x) not in (int, float) or not math.isfinite(x) for x in value):
        raise ValueError('A region needs four finite coordinates')
    x, y, width, height = value
    if x < 0 or y < 0 or width < minimum or height < minimum or x + width > 1.000001 or y + height > 1.000001:
        raise ValueError('Region falls outside the source page')
    return [float(x), float(y), float(width), float(height)]


class SelectedPDF:
    def __init__(self):
        self.document = None
        self.pending = {}
        self.inspected_pages = set()
        self.visually_verified_pages = set()
        self.visual_regions = {}
        self.page_aspects = {}
        self.revision = 0
        self.operations = 0
        self.current_view = None
        self.view_revision = 0

    def action_diagnostic(self, name, arguments, error=None):
        diagnostic = {'tool': name if name in DOCUMENT_TOOLS else 'unknown-document-tool',
                      'code': VALIDATION_CODES.get(str(error), 'document-action-invalid') if error else 'requested',
                      'arguments_type': value_kind(arguments)}
        if not isinstance(arguments, dict): return diagnostic
        allowed = {'read_selected_pdf_page': {'page', 'region'},
                   'mark_selected_pdf': {'page', 'marks', 'replace'},
                   'close_selected_pdf_view': set()}.get(name, set())
        diagnostic['fields'] = sorted(set(arguments) & allowed)
        diagnostic['unexpected_field_count'] = min(99, len(set(arguments) - allowed))
        page = arguments.get('page')
        diagnostic['page_type'] = value_kind(page)
        if type(page) is int and 1 <= page <= 200:
            diagnostic.update(page=page, page_inspected=page in self.visually_verified_pages)
        marks = arguments.get('marks')
        if isinstance(marks, list):
            diagnostic['marks_count'] = min(99, len(marks))
            shapes = []
            for mark in marks[:6]:
                shape = {'type': value_kind(mark)}
                if isinstance(mark, dict):
                    known = {'kind', 'region', 'region_id', 'label'}
                    shape.update(fields=sorted(set(mark) & known), unexpected_field_count=min(99, len(set(mark) - known)))
                    shape['kind'] = mark.get('kind') if mark.get('kind') in ('box', 'ellipse', 'arrow') else 'invalid'
                    shape['kind_type'] = value_kind(mark.get('kind'))
                    if 'label' in mark:
                        shape['label_type'] = value_kind(mark['label'])
                        if isinstance(mark['label'], str): shape['label_length'] = min(999, len(mark['label']))
                    if 'region_id' in mark:
                        identity = mark['region_id']
                        source = self.visual_regions.get(identity) if isinstance(identity, str) else None
                        shape.update(region_id_type=value_kind(identity), region_id_known=source is not None,
                                     region_id_matches_page=source is not None and source['page'] == page)
                        if source is not None: shape['region_id'] = source['id']
                    if 'region' in mark:
                        coordinates = mark['region']
                        shape.update(region_type=value_kind(coordinates),
                                     region_length=min(99, len(coordinates)) if isinstance(coordinates, list) else None)
                shapes.append(shape)
            diagnostic['marks'] = shapes
        return diagnostic

    def offer(self, value):
        if not isinstance(value, dict) or set(value) - {'id', 'name', 'pages', 'bytes', 'kind', 'scope', 'approved', 'source_format'}:
            raise ValueError('Unexpected document metadata')
        if value.get('approved') is not True:
            raise ValueError('The visitor has not approved sharing document pages')
        identity = value.get('id')
        if not isinstance(identity, str) or not re.fullmatch(r'[a-f0-9]{64}', identity):
            raise ValueError('Missing document fingerprint')
        name = value.get('name')
        if not isinstance(name, str) or not 1 <= len(name) <= 180 or any(ord(c) < 32 for c in name):
            raise ValueError('Invalid document display name')
        if type(value.get('pages')) is not int or not 1 <= value['pages'] <= 200:
            raise ValueError('Invalid page count')
        if type(value.get('bytes')) is not int or not 8 <= value['bytes'] <= 20 * 1024 * 1024:
            raise ValueError('Invalid document size')
        if value.get('kind') != 'visitor-selected-pdf':
            raise ValueError('Only the selected local PDF is authorized')
        if value.get('source_format', 'pdf') not in {'pdf', 'converted-pptx'}:
            raise ValueError('Unknown source rendering format')
        if self.pending:
            raise ValueError('Finish or cancel the pending page action before replacing the selected document')
        self.document = {key: value[key] for key in ['id', 'name', 'pages', 'bytes', 'kind']}
        if value.get('source_format'):
            self.document['source_format'] = value['source_format']
        self.inspected_pages.clear()
        self.visually_verified_pages.clear()
        self.visual_regions.clear()
        self.page_aspects.clear()
        self.current_view = None
        self.view_revision = 0
        self.revision += 1
        return self.description()

    def select_view(self, value):
        """Selection metadata is neither page evidence nor a display receipt."""
        if not self.document:
            raise ValueError('No visitor-selected PDF is approved in this conversation')
        if not isinstance(value, dict) or set(value) != {'document_id', 'page', 'region', 'view_revision'}:
            raise ValueError('Invalid selected-page metadata')
        if value['document_id'] != self.document['id']:
            raise ValueError('The selected page belongs to another document')
        if type(value['page']) is not int or not 1 <= value['page'] <= self.document['pages']:
            raise ValueError('That page does not exist')
        if type(value['view_revision']) is not int or not self.view_revision < value['view_revision'] <= 10000:
            raise ValueError('Stale selected-page metadata')
        coordinates = region(value['region'])
        self.current_view = {'page': value['page'], 'region': coordinates}
        self.view_revision = value['view_revision']
        self.pending.clear()
        return self.description()

    def description(self):
        return {'selected_document': self.document, 'revision': self.revision,
                'scope': ('LibreOffice PDF rendering of a visitor-selected PPTX. Fonts and effects may differ; animation is not preserved. ' if self.document and self.document.get('source_format') == 'converted-pptx' else 'Visitor-selected original PDF. ') + 'Only pages actually inspected during this conversation are evidence. A file name is not evidence of its contents.',
                'inspected_pages': sorted(self.inspected_pages),
                'current_view': ({**self.current_view, 'view_revision': self.view_revision,
                                  'visually_inspected': self.current_view['page'] in self.visually_verified_pages}
                                 if self.current_view else None)}

    def revoke(self):
        self.document = None
        self.pending.clear()
        self.inspected_pages.clear()
        self.visually_verified_pages.clear()
        self.visual_regions.clear()
        self.page_aspects.clear()
        self.current_view = None
        self.view_revision = 0
        self.revision += 1

    def register_visual_regions(self, page, image_hash, observations, *, document_id=None):
        if not self.document or document_id != self.document["id"] or page not in self.inspected_pages or not isinstance(observations, list):
            raise ValueError('The actual source page must be read before registering visual regions')
        if not isinstance(image_hash, str) or not re.fullmatch(r'[a-f0-9]{64}', image_hash):
            raise ValueError('A successful exact image fingerprint is required')
        checked = []
        for index, observation in enumerate(observations[:8]):
            coordinates = region(observation['region'], minimum=.001)
            identity = f"p{page}-{image_hash[:10]}-r{index + 1}"
            item = {'id': identity, 'label': observation['label'], 'region': coordinates, 'page': page,
                    'image_sha256': image_hash}
            self.visual_regions[identity] = item
            checked.append(item)
        self.visually_verified_pages.add(page)
        return checked

    def propose(self, name, arguments):
        if not self.document:
            raise ValueError('No visitor-selected PDF is approved in this conversation')
        if self.pending:
            raise ValueError('Wait for the preceding PDF action to finish')
        if self.operations >= 30:
            raise ValueError('The thirty-operation document budget is exhausted')
        if not isinstance(arguments, dict):
            raise ValueError('Invalid PDF action arguments')
        operation = {'action_id': secrets.token_hex(16), 'document_id': self.document['id'],
                     'revision': self.revision + 1, 'view_revision': self.view_revision}
        if name == 'read_selected_pdf_page':
            if set(arguments) - {'page', 'region'}: raise ValueError('Unexpected reading fields')
            page = arguments.get('page')
            if type(page) is not int or not 1 <= page <= self.document['pages']:
                raise ValueError('That page does not exist')
            operation.update(kind='read', page=page, region=region(arguments.get('region', [0, 0, 1, 1])))
        elif name == 'mark_selected_pdf':
            if set(arguments) - {'page', 'marks', 'replace'}: raise ValueError('Unexpected annotation fields')
            page = arguments.get('page')
            if type(page) is not int or page not in self.visually_verified_pages:
                raise ValueError('A successful source-pixel inspection is required before placing an annotation; do not guess from extracted text')
            marks = arguments.get('marks')
            if not isinstance(marks, list) or not 1 <= len(marks) <= 6:
                raise ValueError('Use one to six source-anchored annotations')
            checked = []
            for mark in marks:
                if not isinstance(mark, dict) or set(mark) - {'kind', 'region', 'region_id', 'label'}:
                    raise ValueError('Unexpected annotation fields')
                kind = mark.get('kind')
                if kind not in {'box', 'ellipse', 'arrow'}: raise ValueError('Unsupported annotation type')
                label = mark.get('label', '')
                if not isinstance(label, str) or len(label) > 90 or any(ord(c) < 32 for c in label):
                    raise ValueError('Use a short annotation label')
                if mark.get('region_id'):
                    if not isinstance(mark['region_id'], str) or len(mark['region_id']) > 80:
                        raise ValueError('Invalid source region identifier')
                    source_region = self.visual_regions.get(mark['region_id'])
                    if source_region is None or source_region['page'] != page:
                        raise ValueError('Select a returned visual region ID from this exact inspected page')
                    if 'region' in mark:
                        raise ValueError('Use a source region ID or explicit coordinates, not both')
                    coordinates = source_region['region']
                    label = label or source_region['label'][:90]
                else:
                    coordinates = region(mark.get('region'), minimum=.001)
                checked.append({'kind': kind, 'region': coordinates, 'label': label})
            replace = arguments.get('replace', True)
            if type(replace) is not bool: raise ValueError('Replace must be a boolean')
            operation.update(kind='mark', page=page, marks=checked, replace=replace)
        elif name == 'close_selected_pdf_view':
            if arguments: raise ValueError('Closing the view takes no arguments')
            operation.update(kind='hide')
        else:
            raise ValueError('Unknown PDF operation')
        self.operations += 1
        self.pending[operation['action_id']] = operation
        return operation

    def acknowledge(self, value):
        if not isinstance(value, dict): raise ValueError('Invalid document acknowledgement')
        identity = value.get('action_id')
        pending = self.pending.get(identity)
        if not pending: raise ValueError('No matching document operation')
        if value.get('document_id') != pending['document_id'] or value.get('revision') != pending['revision']:
            raise ValueError('Stale document acknowledgement')
        if value.get('ok') is not True:
            self.pending.pop(identity)
            return {'status': 'not-displayed', 'answer': 'The browser could not complete this PDF operation. Do not say it succeeded.'}
        if pending['kind'] == 'read':
            if value.get('page') != pending['page'] or value.get('region') != pending['region']:
                raise ValueError('The returned page/region does not match the request')
            text = value.get('text', '')
            if not isinstance(text, str) or len(text) > 14500:
                raise ValueError('Page text exceeds the inspection budget')
            image = value.get('image')
            if not isinstance(image, dict) or image.get('mime_type') != 'image/jpeg' or not isinstance(image.get('data'), str) or len(image['data']) > 350000:
                raise ValueError('A bounded original page image is required')
            try:
                data = base64.b64decode(image['data'], validate=True)
                with Image.open(io.BytesIO(data)) as bitmap:
                    if bitmap.format != 'JPEG' or bitmap.width < 1 or bitmap.height < 1 or bitmap.width > 1600 or bitmap.height > 1800 or bitmap.width * bitmap.height > 2_600_000:
                        raise ValueError('Page image dimensions exceed the budget')
                    image_width, image_height = bitmap.size
                    bitmap.verify()
            except Exception as error:
                raise ValueError('Invalid page image') from error
            source = {'id': 'pdf-' + self.document['id'][:16] + '-p' + str(pending['page']),
                      'title': self.document['name'], 'page': pending['page'], 'document_id': self.document['id'],
                      'excerpt': text, 'source_kind': 'visitor-selected-pdf',
                      'scope': ('Text from a converted PPTX slide; layout/fonts/effects may differ. ' if self.document.get('source_format') == 'converted-pptx' else 'Text extracted from the selected original PDF page. ') + 'Scanned text/equations may be incomplete.'}
            self.inspected_pages.add(pending['page'])
            image_hash = hashlib.sha256(data).hexdigest()
            # Only decoded, validated pixels and the acknowledged crop establish
            # page shape. The thirty-operation budget bounds this hash-keyed map.
            crop = pending['region']
            self.page_aspects[(pending['page'], image_hash)] = image_width * crop[3] / (image_height * crop[2])
            result = {'status': 'page-inspected', 'document': dict(self.document), 'page': pending['page'],
                      'region': pending['region'], 'sources': [source],
                      'answer': 'The actual source page is displayed. Read its attached original page pixels and extracted text before interpreting the figure. Report uncertainty when fine labels are not legible.',
                      '_page_image': {'data': image['data'], 'sha256': image_hash, 'mime_type': 'image/jpeg',
                                      'width': image_width, 'height': image_height}}
            self.current_view = {'page': pending['page'], 'region': list(pending['region']), 'visible': True}
        elif pending['kind'] == 'mark':
            if value.get('page') != pending['page'] or value.get('mark_count') != len(pending['marks']):
                raise ValueError('Annotation acknowledgement does not match the request')
            displayed_region = region(value.get('region'))
            if 'view_region' in pending and displayed_region != pending['view_region']:
                raise ValueError('The teaching crop acknowledgement does not match the source view')
            result = {'status': 'page-annotated', 'document_id': pending['document_id'], 'page': pending['page'],
                      'marks': pending['marks'], 'answer': 'The annotations are now visible as an explanatory overlay; the original page has not been edited.'}
            self.current_view = {'page': pending['page'], 'region': displayed_region, 'visible': True}
        else:
            result = {'status': 'page-hidden', 'answer': 'The PDF view is hidden. The file remains selected until the visitor removes it.'}
            self.current_view = None
        result['current_view'] = {**self.current_view, 'view_revision': self.view_revision} if self.current_view else None
        self.revision = pending['revision']
        self.pending.pop(identity)
        return result

    def abort(self, identity):
        self.pending.pop(identity, None)

    def cancel_pending(self):
        self.pending.clear()


def declarations():
    return [
        {'name': 'read_selected_pdf_page', 'behavior': 'BLOCKING',
         'description': 'Read and DISPLAY an original page from the PDF the visitor explicitly selected and approved in this browser. For a requested figure walkthrough on an uninspected page, include walkthrough with the visitor\'s full question and the requested step count (default three). This inspects pixels and progressively teaches directly in one request; do not separately plan or call teach_source afterward. Otherwise returns the actual pixel observation, regions and extracted text. Do not invent details if inspection fails. Read the currently selected page first. Region is normalized [left, top, width, height] relative to the FULL page; omit for the full page. Filenames and metadata are not evidence.',
         'parameters': {'type': 'OBJECT', 'properties': {'page': {'type': 'INTEGER'}, 'region': {'type': 'ARRAY', 'items': {'type': 'NUMBER'}},
             'walkthrough': {'type': 'OBJECT', 'properties': {'question': {'type': 'STRING', 'minLength': 3, 'maxLength': 1200},
                 'steps': {'type': 'INTEGER', 'minimum': 2, 'maximum': 6}}, 'required': ['question', 'steps']}}, 'required': ['page']}},
        {'name': 'mark_selected_pdf', 'behavior': 'BLOCKING',
         'description': 'Add non-destructive visible annotations to an ACTUALLY INSPECTED original PDF page. Prefer a region_id from the returned visual_observation.regions, selecting the object by its actual source label. The server resolves its inspected coordinates. Only use explicit full-page normalized coordinates for a region not already identified. Never use the conceptual focus_visual tool for a PDF figure. Boxes/ellipses use bounding regions; arrows run from the top-left to bottom-right of the region. Labels are your explanation, not source evidence. Wait for a rendered acknowledgement before claiming the marks appeared.',
         'parameters': {'type': 'OBJECT', 'properties': {'page': {'type': 'INTEGER'}, 'replace': {'type': 'BOOLEAN'}, 'marks': {'type': 'ARRAY', 'items': {'type': 'OBJECT', 'properties': {'kind': {'type': 'STRING', 'enum': ['box', 'ellipse', 'arrow']}, 'region': {'type': 'ARRAY', 'items': {'type': 'NUMBER'}}, 'region_id': {'type': 'STRING'}, 'label': {'type': 'STRING'}}, 'required': ['kind']}}}, 'required': ['page', 'marks']}},
        {'name': 'close_selected_pdf_view', 'behavior': 'BLOCKING', 'description': 'Hide the PDF page after its explanation. This does not delete the visitor file or finish the voice conversation.', 'parameters': {'type': 'OBJECT', 'properties': {}}},
    ]
