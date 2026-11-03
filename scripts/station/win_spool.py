"""Submit one complete EPL document to a Windows RAW printer handle."""
import ctypes as c
from contextlib import contextmanager


class DocInfo(c.Structure):
    _fields_ = [("name", c.c_wchar_p), ("output", c.c_wchar_p), ("datatype", c.c_wchar_p)]


# PRINTER_INFO_2W. Only the queue identity fields are dereferenced.
class PrinterInfo(c.Structure):
    _fields_ = [
        ("server", c.c_void_p), ("name", c.c_wchar_p), ("share", c.c_wchar_p),
        ("port", c.c_wchar_p), ("driver_to_security_descriptor", c.c_void_p * 9),
        ("attributes", c.c_uint32), ("priority_to_average_ppm", c.c_uint32 * 7),
    ]


def load_spooler():
    lib = c.WinDLL("winspool.drv", use_last_error=True)
    handle, dword = c.c_void_p, c.c_uint32
    prototypes = {
        "EnumPrintersW": ([dword, c.c_wchar_p, dword, c.c_void_p, dword,
                           c.POINTER(dword), c.POINTER(dword)], c.c_int),
        "OpenPrinterW": ([c.c_wchar_p, c.POINTER(handle), c.c_void_p], c.c_int),
        "StartDocPrinterW": ([handle, dword, c.POINTER(DocInfo)], dword),
        "StartPagePrinter": ([handle], c.c_int),
        "WritePrinter": ([handle, c.c_void_p, dword, c.POINTER(dword)], c.c_int),
        "EndPagePrinter": ([handle], c.c_int),
        "EndDocPrinter": ([handle], c.c_int),
        "AbortPrinter": ([handle], c.c_int),
        "ClosePrinter": ([handle], c.c_int),
    }
    for name, (args, result) in prototypes.items():
        fn = getattr(lib, name)
        fn.argtypes, fn.restype = args, result
    return lib


def checked(result):
    if not result:
        raise c.WinError(c.get_last_error())
    return result


def local_shared_queues(spooler):
    needed, count = c.c_uint32(), c.c_uint32()
    enum = spooler.EnumPrintersW
    if not enum(2, None, 2, None, 0, c.byref(needed), c.byref(count)):
        if c.get_last_error() != 122:  # ERROR_INSUFFICIENT_BUFFER is the sizing probe.
            checked(0)
    if not needed.value:
        return []
    buffer = c.create_string_buffer(needed.value)
    checked(enum(2, None, 2, buffer, len(buffer), c.byref(needed), c.byref(count)))
    rows = c.cast(buffer, c.POINTER(PrinterInfo))
    return [(p.share, p.name, p.port) for p in rows[:count.value]
            if p.attributes & 8 and p.share and p.name and p.port]  # PRINTER_ATTRIBUTE_SHARED


def resolve_queue(queues, share):
    roles = {}
    for role, name, port in queues:
        role = role.upper()
        if role in ("HWBP", "HWBT"):
            if role in roles or "," in port:
                raise ValueError(f"Ambiguous or pooled printer share {role}")
            roles[role] = (name, port)
    if set(roles) != {"HWBP", "HWBT"}:
        raise ValueError("Configure both local printer shares HWBP and HWBT")
    if roles["HWBP"][1].casefold() == roles["HWBT"][1].casefold():
        raise ValueError("Boarding pass and bag tag shares use the same port")
    return roles[share][0]


@contextmanager
def open_queue(share):
    spooler = load_spooler()
    name = resolve_queue(local_shared_queues(spooler), share)
    handle = c.c_void_p()
    checked(spooler.OpenPrinterW(name, c.byref(handle), None))
    try:
        yield spooler, handle
    finally:
        spooler.ClosePrinter(handle)


def send_raw(queue, data, receipt, record_job_id):
    spooler, handle = queue
    info = DocInfo(f"AIS station {receipt}", None, "RAW")
    job_id = checked(spooler.StartDocPrinterW(handle, 1, c.byref(info)))
    try:
        record_job_id(job_id)
        checked(spooler.StartPagePrinter(handle))
        count = c.c_uint32()
        checked(spooler.WritePrinter(handle, data, len(data), c.byref(count)))
        if count.value != len(data):
            raise OSError("Incomplete RAW write")
        checked(spooler.EndPagePrinter(handle))
        checked(spooler.EndDocPrinter(handle))
    except BaseException:
        spooler.AbortPrinter(handle)
        raise
