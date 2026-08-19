"""Class-balanced fitting for arbitrary sklearn-style estimators.

label_task is ~75% positive / 25% negative. Models with native class_weight
support (SVC, RandomForestClassifier, LogisticRegression) handle that
directly. Others (HistGradientBoostingClassifier, MLPClassifier, and every
regressor used for blended-target KD students) don't -- fit on this data
unweighted, they collapse to predicting the majority class for everyone
(exactly the bug found and fixed in DistilledLogisticStudent earlier this
session). BalancedWrapper fixes that uniformly: pass balanced sample_weight
if the estimator's fit() accepts it, otherwise fall back to weighted-row
duplication, which achieves the same rebalancing for estimators that don't
support sample_weight at all (e.g. MLPClassifier/MLPRegressor).
"""

import numpy as np
from sklearn.base import BaseEstimator, ClassifierMixin
from sklearn.utils.class_weight import compute_sample_weight


class BalancedWrapper(BaseEstimator, ClassifierMixin):
    """Wraps an estimator factory so .fit always sees class-balanced data.

    Inherits BaseEstimator/ClassifierMixin purely so sklearn's newer
    __sklearn_tags__ machinery accepts this as a Pipeline step (e.g. inside
    make_pipeline(StandardScaler(), BalancedWrapper(...))) -- it doesn't use
    their param-management behavior itself.
    """

    def __init__(self, estimator_factory):
        self.estimator_factory = estimator_factory

    def fit(self, X, y, sample_weight=None):
        # Trailing underscore is sklearn's convention for "set once fitted" --
        # check_is_fitted() (used by Pipeline.predict) looks for exactly this.
        self.model_ = self.estimator_factory()
        if sample_weight is None:
            sample_weight = compute_sample_weight('balanced', y)
        try:
            self.model_.fit(X, y, sample_weight=sample_weight)
        except TypeError:
            counts = np.maximum(1, np.round(sample_weight / sample_weight.min()).astype(int))
            idx = np.repeat(np.arange(len(X)), counts)
            self.model_.fit(X[idx], y[idx])
        return self

    def predict(self, X):
        return self.model_.predict(X)

    def predict_proba(self, X):
        return self.model_.predict_proba(X)

    def __getstate__(self):
        # estimator_factory is often an inline lambda (see train.py's MODELS
        # dict) -- unpicklable, and unneeded after fitting since predict/
        # predict_proba only touch model_. Drop it so fitted instances (e.g.
        # inside a saved joblib artifact) can be pickled; re-fitting a
        # restored instance would need a real factory reassigned first.
        state = self.__dict__.copy()
        state['estimator_factory'] = None
        return state
