// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
package com.estella.host;

import android.app.Activity;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.BaseInputConnection;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.TextView;

/**
 * The app's editing surface: one real EditText, invisible, that the IME talks to.
 *
 * An IME does not deliver composed text (Chinese, Japanese, prediction) as key
 * events -- it commits through an InputConnection, which only a Java View has.
 * That is the whole reason this class exists: everything else about the field --
 * how it looks, where the caret is, what it does with the text -- is engine code
 * on the other side of the JNI, and this holds only what the platform insists on
 * owning.
 *
 * Every method that touches the view runs on the UI thread; the native side calls
 * in from the game thread, and reports go back the other way through the static
 * natives, whose C++ queues them for the next frame.
 */
public final class TextEditor implements TextWatcher {

    private final Activity activity;
    private EditText field;
    /** Set while the native side is writing, so its own write is not reported back. */
    private boolean writing;

    public TextEditor(Activity activity) {
        this.activity = activity;
    }

    /** Open the keyboard on `value`, with the caret/selection where the field has it. */
    public void focus(final String value, final int selectionStart, final int selectionEnd,
                      final boolean multiline, final int maxLength, final boolean password) {
        activity.runOnUiThread(new Runnable() {
            @Override public void run() {
                ensureField();
                writing = true;
                field.setInputType(inputType(multiline, password));
                field.setImeOptions(multiline ? EditorInfo.IME_ACTION_NONE : EditorInfo.IME_ACTION_DONE);
                field.setFilters(maxLength > 0
                        ? new android.text.InputFilter[] { new android.text.InputFilter.LengthFilter(maxLength) }
                        : new android.text.InputFilter[0]);
                field.setText(value);
                setSelection(selectionStart, selectionEnd);
                writing = false;
                field.setVisibility(View.VISIBLE);
                field.requestFocus();
                imm().showSoftInput(field, InputMethodManager.SHOW_IMPLICIT);
            }
        });
    }

    /** Close the keyboard and give up focus. */
    public void blur() {
        activity.runOnUiThread(new Runnable() {
            @Override public void run() {
                if (field == null) return;
                imm().hideSoftInputFromWindow(field.getWindowToken(), 0);
                field.clearFocus();
                // Gone, not invisible: a focusable view left in the tree can take
                // focus back from the game's own surface on the next layout.
                field.setVisibility(View.GONE);
            }
        });
    }

    /** Adopt a value + selection the app decided (setValue, a tap that moved the caret). */
    public void write(final String value, final int selectionStart, final int selectionEnd) {
        activity.runOnUiThread(new Runnable() {
            @Override public void run() {
                if (field == null) return;
                writing = true;
                if (!field.getText().toString().equals(value)) field.setText(value);
                setSelection(selectionStart, selectionEnd);
                writing = false;
            }
        });
    }

    // -- TextWatcher: the IME's commits and the user's typing --------------------

    @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

    @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}

    @Override public void afterTextChanged(Editable s) {
        report();
    }

    /** Hand the field's whole state to the engine. Composing is asked of the
     *  Editable itself: a preedit is a span the IME put there, not a flag. */
    private void report() {
        if (writing || field == null) return;
        final Editable text = field.getText();
        final boolean composing = BaseInputConnection.getComposingSpanStart(text) >= 0
                && BaseInputConnection.getComposingSpanEnd(text) >= 0;
        nativeState(text.toString(), field.getSelectionStart(), field.getSelectionEnd(), composing);
    }

    private void setSelection(int start, int end) {
        final int len = field.getText().length();
        field.setSelection(clamp(start, len), clamp(end, len));
    }

    private static int clamp(int index, int length) {
        return index < 0 ? 0 : (index > length ? length : index);
    }

    private static int inputType(boolean multiline, boolean password) {
        if (password) return InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD;
        int type = InputType.TYPE_CLASS_TEXT;
        if (multiline) type |= InputType.TYPE_TEXT_FLAG_MULTI_LINE;
        return type;
    }

    private InputMethodManager imm() {
        return (InputMethodManager) activity.getSystemService(Activity.INPUT_METHOD_SERVICE);
    }

    /** The view, created on first use and left in the tree. 1x1 and transparent:
     *  it must be a real, laid-out, focusable view for the IME to attach to it,
     *  but the game draws the field itself. */
    private void ensureField() {
        if (field != null) return;
        field = new EditText(activity) {
            @Override protected void onSelectionChanged(int start, int end) {
                super.onSelectionChanged(start, end);
                report();   // a caret move is state too, and TextWatcher never sees it
            }
        };
        field.setBackgroundColor(0);
        field.setTextColor(0);
        field.setCursorVisible(false);
        field.setSingleLine(false);
        field.addTextChangedListener(this);
        field.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (actionId == EditorInfo.IME_ACTION_DONE || actionId == EditorInfo.IME_ACTION_GO
                        || actionId == EditorInfo.IME_ACTION_SEND
                        || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                    nativeSubmit();
                    return true;
                }
                return false;
            }
        });
        // Back dismisses the keyboard without committing — the field should lose
        // focus, exactly as Escape does on the web.
        field.setOnKeyListener(new View.OnKeyListener() {
            @Override public boolean onKey(View v, int keyCode, KeyEvent event) {
                if (keyCode == KeyEvent.KEYCODE_BACK && event.getAction() == KeyEvent.ACTION_UP) {
                    nativeCancel();
                    return true;
                }
                return false;
            }
        });
        final ViewGroup.LayoutParams params = new ViewGroup.LayoutParams(1, 1);
        field.setGravity(Gravity.TOP | Gravity.START);
        activity.addContentView(field, params);
    }

    // -- Into the engine (registered from C++ with RegisterNatives) --------------

    private static native void nativeState(String value, int selectionStart, int selectionEnd, boolean composing);
    private static native void nativeSubmit();
    private static native void nativeCancel();
}
