"""Pure reasoning helpers: arithmetic, visible plans and reviewable in-memory drafts.

This is not a shell, browser automation agent, filesystem writer, email sender,
calendar mutator or paid agent runner. Execution and publication are not conflated.
"""
from __future__ import annotations
import ast
from decimal import Decimal, localcontext, InvalidOperation
import hashlib
import re


def arithmetic(expression):
    if not isinstance(expression,str) or not 1<=len(expression)<=350:raise ValueError('Use a short arithmetic expression.')
    tree=ast.parse(expression,mode='eval')
    if sum(1 for _ in ast.walk(tree))>70:raise ValueError('The expression is too complex.')
    def visit(item):
        if isinstance(item,ast.Expression):return visit(item.body)
        if isinstance(item,ast.Constant) and type(item.value) in (int,float):
            literal=ast.get_source_segment(expression,item).replace('_','')
            if not re.fullmatch(r'(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?',literal):raise ValueError('Use decimal numeric literals.')
            value=Decimal(literal)
        elif isinstance(item,ast.UnaryOp) and isinstance(item.op,(ast.UAdd,ast.USub)):
            value=visit(item.operand)*(1 if isinstance(item.op,ast.UAdd) else -1)
        elif isinstance(item,ast.BinOp):
            left,right=visit(item.left),visit(item.right)
            if isinstance(item.op,ast.Add):value=left+right
            elif isinstance(item.op,ast.Sub):value=left-right
            elif isinstance(item.op,ast.Mult):value=left*right
            elif isinstance(item.op,ast.Div):value=left/right
            elif isinstance(item.op,ast.Pow) and right==int(right) and abs(right)<=20:value=left**int(right)
            else:raise ValueError('Unsupported arithmetic operation.')
        elif isinstance(item,ast.Call) and isinstance(item.func,ast.Name) and not item.keywords:
            values=[visit(argument) for argument in item.args]
            if item.func.id=='sqrt' and len(values)==1:value=values[0].sqrt()
            elif item.func.id=='abs' and len(values)==1:value=abs(values[0])
            elif item.func.id=='min' and 1<=len(values)<=15:value=min(values)
            elif item.func.id=='max' and 1<=len(values)<=15:value=max(values)
            else:raise ValueError('Only sqrt, abs, min and max are supported.')
        else:raise ValueError('No code execution, variables, attributes or objects are accepted.')
        if not value.is_finite() or abs(value)>Decimal('1e80') or (value and value.adjusted() < -100):raise ValueError('Arithmetic exceeds its range.')
        return value
    try:
        with localcontext() as context:
            context.prec=32;value=visit(tree)
            output=format(value,'f')
        return {'status':'calculated','expression':expression,'result':output,
                'method':'32-digit Decimal arithmetic; no eval, exec, shell or network',
                'rounding_limit':'Non-terminating operations are rounded to the stated precision.'}
    except (ArithmeticError,InvalidOperation,OverflowError):raise ValueError('Undefined or out-of-range arithmetic.')


def declarations():
    return [
      {'name':'calculate','behavior':'BLOCKING','description':'Compute arithmetic exactly where possible. Use for percentages, comparisons and numerical reasoning. Not a code interpreter.',
       'parameters':{'type':'OBJECT','properties':{'expression':{'type':'STRING'}},'required':['expression']}},
      {'name':'plan_work','behavior':'BLOCKING','description':'Show the visitor a short actionable plan for the requested research, reading, comparison, calculation or draft. Plans are intentions, not completed work. Execute the allowed read/calculation tools afterwards; do not promise external actions.',
       'parameters':{'type':'OBJECT','properties':{'goal':{'type':'STRING'},'steps':{'type':'ARRAY','items':{'type':'STRING'}}},'required':['goal','steps']}},
      {'name':'deliver_note','behavior':'BLOCKING','description':'Deliver a reviewable Markdown note or report in this conversation after reading and reasoning. Cite only source IDs actually returned by tools in this session. This returns text for the visitor to download; it does not write machine files, publish, send, or claim external tasks are completed.',
       'parameters':{'type':'OBJECT','properties':{'title':{'type':'STRING'},'markdown':{'type':'STRING'},'source_ids':{'type':'ARRAY','items':{'type':'STRING'}}},'required':['title','markdown']}}
    ]


class ReasoningSession:
    def __init__(self):self.plan=None;self.events=[];self.sources={};self.drafts=[]
    def observe(self,name,result):
        for source in result.get('sources',[]):
            if source.get('id'):self.sources[source['id']]=source
        if len(self.events)<60:self.events.append({'tool':name,'status':result.get('status','returned-evidence'),'source_count':len(result.get('sources',[]))})
    def run(self,name,args):
        if not isinstance(args,dict):raise ValueError('Invalid tool input.')
        if name=='calculate':return arithmetic(args.get('expression'))
        if name=='plan_work':
            goal=args.get('goal');steps=args.get('steps')
            if not isinstance(goal,str) or not 3<=len(goal)<=400 or not isinstance(steps,list) or not 1<=len(steps)<=8 or any(not isinstance(step,str) or not 3<=len(step)<=220 for step in steps):raise ValueError('Use a short goal and one to eight bounded steps.')
            self.plan={'goal':goal,'steps':steps,'status':'planned-not-executed'}
            return {'status':'plan-created','plan':self.plan,'boundary':'Only tools actually executed are work evidence. External writes and account actions are unavailable.'}
        if name=='deliver_note':
            title=args.get('title');body=args.get('markdown');ids=args.get('source_ids',[])
            if not isinstance(title,str) or not 1<=len(title)<=160 or not isinstance(body,str) or not 20<=len(body)<=20000 or not isinstance(ids,list) or len(ids)>12:raise ValueError('Draft exceeds its bounded format.')
            if any(not isinstance(identity,str) or identity not in self.sources for identity in ids):raise ValueError('Draft cites a source that was not inspected in this session.')
            if len(self.drafts)>=4:raise ValueError('The session draft limit is four.')
            sources=[self.sources[identity] for identity in dict.fromkeys(ids)]
            pages={source.get('url'):source for source in sources}
            footer='\n\n## Sources inspected\n'+''.join(f"\n- {source.get('title','Source')}: {source.get('url','')}" for source in pages.values()) if sources else '\n\nNo external factual sources cited. Treat this as reasoning or a draft, not verified research.'
            text=(body if body.lstrip().startswith('# ') else '# '+title+'\n\n'+body)+footer+'\n\n---\nReviewable AI-authored draft. No external action has been performed.\n'
            result={'status':'draft-ready','title':title,'markdown':text,'sha256':hashlib.sha256(text.encode()).hexdigest(),'sources':sources,'tool_receipts':list(self.events)}
            self.drafts.append(result);return result
        raise ValueError('Unknown reasoning tool.')
