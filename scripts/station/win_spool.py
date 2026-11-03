"""Submit one complete EPL document to a Windows RAW printer handle."""
import ctypes as c
from contextlib import contextmanager


class DocInfo(c.Structure):
    _fields_ = [("name", c.c_wchar_p), ("output", c.c_wchar_p), ("datatype", c.c_wchar_p)]


def load_spooler():
    lib = c.WinDLL("winspool.drv", use_last_error=True)
    handle, dword = c.c_void_p, c.c_uint32
    prototypes = {
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


@contextmanager
def open_queue(name):
    spooler = load_spooler()
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
