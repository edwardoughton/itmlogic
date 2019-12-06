Contributing guidelines
=======================

We welcome contributions to ``itmlogic``.

When submitting a change to the repository, please first create an issue that covers the item
that you'd like to change, update or enhance. Once a discussion has yielded a vote of support
for that addition to the package, you are ready to submit a pull request.

If you are proposing a feature:

- Explain in detail how it would work.
- Keep the scope as narrow as possible, to make it easier to implement.

Create a branch for local development.
--------------------------------------

- Use the ``git checkout`` command to create your own branch, and pick a name that describes
the changes that you are making.

    $ git checkout -b name-of-your-bugfix-or-feature

Now you can make your changes locally.

Test the package
----------------

Ensure that the tests pass, and the documentation builds successfully::

    $ pytest
    $ make docs

Commit and push your changes
----------------------------

Once you are sure that all tests are passing, you can commit your changes and push to GitHub::

$ git add .
$ git commit -m "Your detailed description of your changes."
$ git push origin name-of-your-bugfix-or-feature
Submit a pull request on GitHub
When submitting a pull request:

All existing tests should pass. Please make sure that the test suite passes, both locally
and on Travis CI <https://travis-ci.org/nismod/itmlogic>_ Status on Travis will be visible on a
pull request. If you want to enable Travis CI on your own fork, please read the getting
started docs <https://docs.travis-ci.com/user/getting-started/>_.

New functionality should include tests. Please write reasonable tests for your code and make
sure that they pass on your pull request.

Classes, methods, functions, etc. should have docstrings. The first line of a docstring
should be a standalone summary. Parameters and return values should be documented explicitly.

The API documentation is automatically generated from docstrings, which should conform to
NumpPy styling. For examples, see the Napoleon docs <https://sphinxcontrib-napoleon.readthedocs.io/en/latest/example_numpy.html>_.

Please note that tests are also run via Travis-CI on our documentation. So be sure that any
.rst file submissions are properly formatted and tests are passing.

Documentation Updates
=====================

Improving the documentation and testing for code already in itmlogic is a great way to get
started if you'd like to make a contribution. Please note that our documentation files are
in ReStructuredText (.rst) <http://www.sphinx-doc.org/en/master/usage/restructuredtext/basics.html>_
format and format your pull request accordingly.

To build the documentation, use the command::

    $ make docs

By default make docs will only rebuild the documentation if source files (e.g., .py or .rst
files) have changed. To force a rebuild, use make -B docs. You can preview the generated
documentation by opening docs/_build/html/index.html in a web browser.
