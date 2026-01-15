import { forwardRef, useImperativeHandle, useRef } from "react";
import VendedorKanban from "./VendedorKanban";

export interface VendedorKanbanRef {
  focusAssignment: (assignmentId: string) => void;
}

const VendedorKanbanWrapper = forwardRef<VendedorKanbanRef, object>(function VendedorKanbanWrapper(_props, ref) {
  const internalRef = useRef<{
    focusAssignment: (assignmentId: string) => void;
  }>(null);

  useImperativeHandle(ref, () => ({
    focusAssignment: (assignmentId: string) => {
      internalRef.current?.focusAssignment(assignmentId);
    }
  }));

  return <VendedorKanban ref={internalRef} />;
});

export default VendedorKanbanWrapper;
