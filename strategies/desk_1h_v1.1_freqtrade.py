# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: תוך־יומי · נר שעה · BTCUSDT · 1h
# Version: v1.1 · Strategy family: ema_trend
# Backtest: return 16.19% · PF 3.34 · DD 3.16% · trades 20
# OOS: 12.66% · Sharpe 10.76
# Params: {"fast":22,"slow":89,"atrStop":1.6,"rr":1.6,"trendFilter":true}
# Target platform: Freqtrade
# Generated: 2026-11-19T22:16:40.339Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_1h --config user_data/config.json
#   freqtrade trade --strategy Altadesk_1h --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_1h(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '1h'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.019
    minimal_roi = {"0": 1.44, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['ema_fast'] = ta.EMA(dataframe, timeperiod=22)
        dataframe['ema_slow'] = ta.EMA(dataframe, timeperiod=89)
        dataframe['ema_trend'] = ta.EMA(dataframe, timeperiod=200)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['ema_fast'] > dataframe['ema_slow'])
        & (dataframe['close'] > dataframe['ema_trend'])
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['ema_fast'] < dataframe['ema_slow'])
        & (dataframe['close'] < dataframe['ema_trend'])
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
        & (dataframe['ema_fast'] > dataframe['ema_slow'])
        & (dataframe['close'] > dataframe['ema_trend'])
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['ema_fast'] < dataframe['ema_slow'])
        & (dataframe['close'] < dataframe['ema_trend'])
            ),
            'exit_long',
        ] = 1
        return dataframe
